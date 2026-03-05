'use client';

import { useCallback, useRef, useReducer, startTransition, useEffect, useState, memo, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import { useTranscriptStreaming } from "@/hooks/useTranscriptStreaming";
import { ConfidenceIndicator } from "./ConfidenceIndicator";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { RecordingStatusBar } from "./RecordingStatusBar";
import { motion, AnimatePresence } from "framer-motion";
import { TranscriptSegmentData, MeetingSpeaker } from "@/types";
import { SpeakerBadge } from "./MeetingDetails/SpeakerBadge";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { getPaletteForColor } from "@/lib/speaker-colors";
import { Play, Check, Plus, X } from "lucide-react";

export interface VirtualizedTranscriptViewProps {
    /** Transcript segments to display */
    segments: TranscriptSegmentData[];
    /** Whether recording is in progress */
    isRecording?: boolean;
    /** Whether recording is paused */
    isPaused?: boolean;
    /** Whether processing/finalizing transcription */
    isProcessing?: boolean;
    /** Whether stopping */
    isStopping?: boolean;
    /** Enable streaming effect for latest segment */
    enableStreaming?: boolean;
    /** Show confidence indicators */
    showConfidence?: boolean;
    /** Completely disable auto-scroll behavior (for meeting details page) */
    disableAutoScroll?: boolean;

    // Pagination props (infinite scroll)
    hasMore?: boolean;
    isLoadingMore?: boolean;
    totalCount?: number;
    loadedCount?: number;
    onLoadMore?: () => void;

    /** Callback when speaker is changed on a segment */
    onSpeakerChange?: (segmentId: string, newSpeaker: string | null) => void;

    /** Current audio playback time in seconds */
    currentPlaybackTime?: number;
    /** Whether audio is currently playing */
    isAudioPlaying?: boolean;
    /** Callback to play audio from a specific timestamp */
    onPlaySegment?: (startTime: number) => void;

    /** Meeting speakers for dropdown */
    speakers?: MeetingSpeaker[];
    /** Get display name and color for a speaker key */
    getSpeakerDisplay?: (key: string | undefined) => { name: string; color: string };
    /** Callback for bulk assigning selected segments */
    onBulkAssignSelected?: (segmentIds: string[], speaker: string) => void;
}

// Threshold for enabling virtualization (below this, use simple rendering)
const VIRTUALIZATION_THRESHOLD = 5;

// Helper function to format seconds as recording-relative time [MM:SS]
function formatRecordingTime(seconds: number | undefined): string {
    if (seconds === undefined) return '[--:--]';

    const totalSeconds = Math.floor(seconds);
    const minutes = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;

    return `[${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
}

// Helper function to remove filler words and repetitions
function cleanStopWords(text: string): string {
    const stopWords = ['uh', 'um', 'er', 'ah', 'hmm', 'hm', 'eh', 'oh'];

    let cleanedText = text;
    stopWords.forEach(word => {
        const pattern = new RegExp(`\\b${word}\\b[,\\s]*`, 'gi');
        cleanedText = cleanedText.replace(pattern, ' ');
    });

    return cleanedText.replace(/\s+/g, ' ').trim();
}

// Speaker dropdown component (replaces SpeakerPopover)
const SpeakerDropdown = memo(function SpeakerDropdown({
    speaker,
    speakerDisplay,
    speakers,
    onSelect,
}: {
    speaker?: string;
    speakerDisplay?: { name: string; color: string };
    speakers: MeetingSpeaker[];
    onSelect: (value: string | null) => void;
}) {
    const [showNewInput, setShowNewInput] = useState(false);
    const [newName, setNewName] = useState('');

    const handleNewSubmit = () => {
        const trimmed = newName.trim();
        if (trimmed) {
            const key = trimmed.toLowerCase().replace(/\s+/g, '_');
            onSelect(key);
        }
        setNewName('');
        setShowNewInput(false);
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                {speaker && speakerDisplay ? (
                    <button type="button" className="cursor-pointer" title="Click to change speaker">
                        <SpeakerBadge name={speakerDisplay.name} speakerKey={speaker} color={speakerDisplay.color} />
                    </button>
                ) : (
                    <button
                        type="button"
                        className="inline-block px-2 py-0.5 rounded text-xs font-medium border border-dashed border-gray-300 bg-gray-50 text-gray-400 cursor-pointer hover:border-gray-400 hover:text-gray-500"
                        title="Click to assign speaker"
                    >
                        Unassigned
                    </button>
                )}
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-48" align="start" sideOffset={4}>
                {speakers.map(s => {
                    const palette = getPaletteForColor(s.color);
                    const isCurrent = s.speaker_key === speaker;
                    return (
                        <DropdownMenuItem
                            key={s.speaker_key}
                            onClick={() => onSelect(s.speaker_key)}
                            className="flex items-center gap-2"
                        >
                            <span className={`w-2.5 h-2.5 rounded-full ${palette.dot} flex-shrink-0`} />
                            <span className="flex-1">{s.display_name}</span>
                            {isCurrent && <Check className="w-3.5 h-3.5 text-blue-600" />}
                        </DropdownMenuItem>
                    );
                })}
                {speakers.length > 0 && <DropdownMenuSeparator />}
                {showNewInput ? (
                    <div className="px-2 py-1.5">
                        <form onSubmit={e => { e.preventDefault(); handleNewSubmit(); }} className="flex gap-1">
                            <input
                                autoFocus
                                value={newName}
                                onChange={e => setNewName(e.target.value)}
                                placeholder="Name..."
                                className="flex-1 text-sm border border-gray-200 rounded px-2 py-0.5 outline-none focus:border-blue-400"
                                onKeyDown={e => { if (e.key === 'Escape') { setShowNewInput(false); setNewName(''); } }}
                            />
                            <button
                                type="submit"
                                disabled={!newName.trim()}
                                className="text-xs px-2 py-0.5 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-40"
                            >
                                Set
                            </button>
                        </form>
                    </div>
                ) : (
                    <DropdownMenuItem onClick={(e) => { e.preventDefault(); setShowNewInput(true); }}>
                        <Plus className="w-3.5 h-3.5 mr-2" />
                        New speaker...
                    </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onSelect(null)} className="text-gray-500">
                    Unassign
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
});

// Memoized transcript segment component
const TranscriptSegment = memo(function TranscriptSegment({
    id,
    timestamp,
    text,
    confidence,
    isStreaming,
    showConfidence,
    speaker,
    onSpeakerChange,
    isActive,
    onPlayClick,
    speakers,
    getSpeakerDisplay,
    isSelected,
    onSelectionClick,
}: {
    id: string;
    timestamp: number;
    text: string;
    confidence?: number;
    isStreaming: boolean;
    showConfidence: boolean;
    speaker?: string;
    onSpeakerChange?: (segmentId: string, newSpeaker: string | null) => void;
    isActive?: boolean;
    onPlayClick?: (time: number) => void;
    speakers?: MeetingSpeaker[];
    getSpeakerDisplay?: (key: string | undefined) => { name: string; color: string };
    isSelected?: boolean;
    onSelectionClick?: (e: React.MouseEvent) => void;
}) {
    const displayText = cleanStopWords(text) || (text.trim() === '' ? '[Silence]' : text);
    const speakerInfo = getSpeakerDisplay
        ? getSpeakerDisplay(speaker)
        : speaker
            ? { name: speaker === 'mic' ? 'You' : speaker === 'system' ? 'Other' : speaker, color: speaker === 'mic' ? 'blue' : speaker === 'system' ? 'purple' : 'blue' }
            : undefined;

    const hasDropdown = onSpeakerChange && speakers && speakers.length > 0;

    return (
        <div
            id={`segment-${id}`}
            className={`mb-3 ${isActive ? 'border-l-2 border-blue-500 bg-blue-50/50 pl-1 -ml-1' : ''} ${
                isSelected ? 'bg-blue-100 ring-1 ring-blue-300 rounded' : ''
            }`}
        >
            <div className="flex items-start gap-2">
                {/* Selection checkbox area — visible on hover or when selected */}
                {onSelectionClick && (
                    <button
                        type="button"
                        onClick={onSelectionClick}
                        className={`mt-1 flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center ${
                            isSelected
                                ? 'bg-blue-500 border-blue-500 text-white'
                                : 'border-gray-300 opacity-0 group-hover:opacity-100 hover:border-gray-400'
                        }`}
                    >
                        {isSelected && <Check className="w-3 h-3" />}
                    </button>
                )}

                <Tooltip>
                    <TooltipTrigger>
                        {onPlayClick ? (
                            <button
                                onClick={() => onPlayClick(timestamp)}
                                className="text-xs text-gray-400 mt-1 flex-shrink-0 min-w-[50px] hover:text-blue-600 group/play flex items-center gap-0.5"
                            >
                                <Play className="w-3 h-3 hidden group-hover/play:inline-block" />
                                <span className="group-hover/play:text-blue-600">{formatRecordingTime(timestamp)}</span>
                            </button>
                        ) : (
                            <span className="text-xs text-gray-400 mt-1 flex-shrink-0 min-w-[50px]">
                                {formatRecordingTime(timestamp)}
                            </span>
                        )}
                    </TooltipTrigger>
                    <TooltipContent>
                        {confidence !== undefined && showConfidence && (
                            <ConfidenceIndicator confidence={confidence} showIndicator={showConfidence} />
                        )}
                    </TooltipContent>
                </Tooltip>
                {hasDropdown ? (
                    <SpeakerDropdown
                        speaker={speaker}
                        speakerDisplay={speakerInfo}
                        speakers={speakers!}
                        onSelect={(value) => onSpeakerChange!(id, value)}
                    />
                ) : onSpeakerChange ? (
                    // Fallback: simple badge for recording page (no speakers list)
                    speaker && speakerInfo ? (
                        <SpeakerBadge name={speakerInfo.name} speakerKey={speaker} color={speakerInfo.color} />
                    ) : null
                ) : speaker && speakerInfo ? (
                    <SpeakerBadge name={speakerInfo.name} speakerKey={speaker} color={speakerInfo.color} />
                ) : null}
                <div className="flex-1">
                    {isStreaming ? (
                        <div className="bg-gray-100 border border-gray-200 rounded-lg px-3 py-2">
                            <p className="text-base text-gray-800 leading-relaxed">{displayText}</p>
                        </div>
                    ) : (
                        <p className="text-base text-gray-800 leading-relaxed">{displayText}</p>
                    )}
                </div>
            </div>
        </div>
    );
});

// Selection action bar
const SelectionActionBar = memo(function SelectionActionBar({
    count,
    speakers,
    onAssign,
    onClear,
}: {
    count: number;
    speakers: MeetingSpeaker[];
    onAssign: (speakerKey: string) => void;
    onClear: () => void;
}) {
    return (
        <div className="absolute bottom-4 left-4 right-4 bg-white border border-gray-200 rounded-lg shadow-lg p-3 flex items-center gap-3 z-20">
            <span className="text-sm font-medium text-gray-700">{count} selected</span>
            <div className="flex items-center gap-1.5 flex-1">
                {speakers.map(s => {
                    const palette = getPaletteForColor(s.color);
                    return (
                        <button
                            key={s.speaker_key}
                            type="button"
                            onClick={() => onAssign(s.speaker_key)}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border ${palette.border} ${palette.bg} ${palette.text} hover:opacity-80`}
                        >
                            <span className={`w-2 h-2 rounded-full ${palette.dot}`} />
                            {s.display_name}
                        </button>
                    );
                })}
            </div>
            <button
                type="button"
                onClick={onClear}
                className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
            >
                <X className="w-3 h-3" />
                Clear
            </button>
        </div>
    );
});

export const VirtualizedTranscriptView: React.FC<VirtualizedTranscriptViewProps> = ({
    segments,
    isRecording = false,
    isPaused = false,
    isProcessing = false,
    isStopping = false,
    enableStreaming = false,
    showConfidence = true,
    disableAutoScroll = false,
    hasMore = false,
    isLoadingMore = false,
    totalCount = 0,
    loadedCount = 0,
    onLoadMore,
    onSpeakerChange,
    currentPlaybackTime,
    isAudioPlaying,
    onPlaySegment,
    speakers,
    getSpeakerDisplay,
    onBulkAssignSelected,
}) => {
    // Selection state
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [selectionAnchorIndex, setSelectionAnchorIndex] = useState<number | null>(null);

    const handleSelectionClick = useCallback((e: React.MouseEvent, segmentId: string, segmentIndex: number) => {
        e.stopPropagation();

        if (e.shiftKey && selectionAnchorIndex !== null) {
            // Range select
            const start = Math.min(selectionAnchorIndex, segmentIndex);
            const end = Math.max(selectionAnchorIndex, segmentIndex);
            const newIds = new Set(selectedIds);
            for (let i = start; i <= end; i++) {
                newIds.add(segments[i].id);
            }
            setSelectedIds(newIds);
        } else if (e.metaKey || e.ctrlKey) {
            // Toggle individual
            const newIds = new Set(selectedIds);
            if (newIds.has(segmentId)) {
                newIds.delete(segmentId);
            } else {
                newIds.add(segmentId);
            }
            setSelectedIds(newIds);
            setSelectionAnchorIndex(segmentIndex);
        } else {
            // Single select (toggle)
            if (selectedIds.has(segmentId) && selectedIds.size === 1) {
                setSelectedIds(new Set());
                setSelectionAnchorIndex(null);
            } else {
                setSelectedIds(new Set([segmentId]));
                setSelectionAnchorIndex(segmentIndex);
            }
        }
    }, [selectedIds, selectionAnchorIndex, segments]);

    const handleBulkAssign = useCallback((speakerKey: string) => {
        if (onBulkAssignSelected && selectedIds.size > 0) {
            onBulkAssignSelected(Array.from(selectedIds), speakerKey);
            setSelectedIds(new Set());
            setSelectionAnchorIndex(null);
        }
    }, [onBulkAssignSelected, selectedIds]);

    const clearSelection = useCallback(() => {
        setSelectedIds(new Set());
        setSelectionAnchorIndex(null);
    }, []);

    // ESC to clear selection
    useEffect(() => {
        if (selectedIds.size === 0) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') clearSelection();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [selectedIds.size, clearSelection]);

    // Active segment detection
    const activeSegmentId = useMemo(() => {
        if (!currentPlaybackTime || !isAudioPlaying) return null;
        for (let i = segments.length - 1; i >= 0; i--) {
            if (segments[i].timestamp <= currentPlaybackTime) return segments[i].id;
        }
        return null;
    }, [segments, currentPlaybackTime, isAudioPlaying]);

    // Create scroll ref first - shared between virtualizer and auto-scroll hook
    const scrollRef = useRef<HTMLDivElement>(null);
    // Ref for infinite scroll trigger element
    const loadMoreTriggerRef = useRef<HTMLDivElement>(null);

    // Force re-render without flushSync (avoids React warning)
    const [, rerender] = useReducer((x: number) => x + 1, 0);

    // Setup virtualizer for efficient rendering of large lists
    const virtualizer = useVirtualizer({
        count: segments.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => 60, // Estimated height per segment
        overscan: 10, // Render extra items above/below viewport
        onChange: () => {
            startTransition(() => {
                rerender();
            });
        },
    });

    // Custom hook for auto-scrolling (supports both virtualized and non-virtualized)
    useAutoScroll({
        scrollRef,
        segments,
        isRecording,
        isPaused,
        virtualizer,
        virtualizationThreshold: VIRTUALIZATION_THRESHOLD,
        disableAutoScroll,
    });

    // Streaming text effect hook (typewriter animation for new transcripts)
    const { streamingSegmentId, getDisplayText } = useTranscriptStreaming(
        segments,
        isRecording,
        enableStreaming
    );

    // Infinite scroll: IntersectionObserver to trigger loading more
    useEffect(() => {
        if (!onLoadMore || !hasMore || isLoadingMore || isRecording || segments.length === 0) {
            return;
        }

        const triggerElement = loadMoreTriggerRef.current;
        if (!triggerElement) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
                    onLoadMore();
                }
            },
            {
                root: null,
                rootMargin: '100px',
                threshold: 0,
            }
        );

        observer.observe(triggerElement);

        return () => observer.disconnect();
    }, [hasMore, isLoadingMore, onLoadMore, isRecording, segments.length]);

    // Scroll-based fallback for fast scrolling
    useEffect(() => {
        if (!onLoadMore || !hasMore || isLoadingMore || isRecording) return;

        const scrollElement = scrollRef.current;
        if (!scrollElement) return;

        let ticking = false;

        const handleScroll = () => {
            if (ticking || isLoadingMore || !hasMore) return;

            ticking = true;
            requestAnimationFrame(() => {
                const { scrollTop, scrollHeight, clientHeight } = scrollElement;
                const scrollBottom = scrollHeight - scrollTop - clientHeight;

                // Trigger load when within 200px of bottom
                if (scrollBottom < 200 && hasMore && !isLoadingMore) {
                    onLoadMore();
                }
                ticking = false;
            });
        };

        scrollElement.addEventListener('scroll', handleScroll, { passive: true });
        return () => scrollElement.removeEventListener('scroll', handleScroll);
    }, [onLoadMore, hasMore, isLoadingMore, isRecording]);

    // Use simple rendering for small lists, virtualization for large lists
    const useVirtualization = segments.length >= VIRTUALIZATION_THRESHOLD;

    const canSelect = !!onBulkAssignSelected && !isRecording;

    const renderSegment = (segment: TranscriptSegmentData, index: number) => {
        const isStreaming = streamingSegmentId === segment.id;
        return (
            <TranscriptSegment
                id={segment.id}
                timestamp={segment.timestamp}
                text={getDisplayText(segment)}
                confidence={segment.confidence}
                isStreaming={isStreaming}
                showConfidence={showConfidence}
                speaker={segment.speaker}
                onSpeakerChange={onSpeakerChange}
                isActive={activeSegmentId === segment.id}
                onPlayClick={onPlaySegment}
                speakers={speakers}
                getSpeakerDisplay={getSpeakerDisplay}
                isSelected={selectedIds.has(segment.id)}
                onSelectionClick={canSelect ? (e) => handleSelectionClick(e, segment.id, index) : undefined}
            />
        );
    };

    return (
        <div ref={scrollRef} className="flex flex-col h-full overflow-y-auto px-4 py-2 relative">
            {/* Recording Status Bar - Sticky at top, always visible when recording */}
            <AnimatePresence>
                {isRecording && (
                    <div className="sticky top-0 z-10 bg-white pb-2">
                        <RecordingStatusBar isPaused={isPaused} />
                    </div>
                )}
            </AnimatePresence>

            {/* Content - add padding when recording to prevent overlap */}
            <div className={isRecording ? 'pt-2' : ''}>
            {segments.length === 0 ? (
                // Empty state
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-center text-gray-500 mt-8"
                >
                    {isRecording ? (
                        <>
                            <div className="flex items-center justify-center mb-3">
                                <div className={`w-3 h-3 rounded-full ${isPaused ? 'bg-orange-500' : 'bg-blue-500 animate-pulse'}`}></div>
                            </div>
                            <p className="text-sm text-gray-600">
                                {isPaused ? 'Recording paused' : 'Listening for speech...'}
                            </p>
                            <p className="text-xs mt-1 text-gray-400">
                                {isPaused ? 'Click resume to continue recording' : 'Speak to see live transcription'}
                            </p>
                        </>
                    ) : (
                        <>
                            <p className="text-lg font-semibold">Welcome to meetily!</p>
                            <p className="text-xs mt-1">Start recording to see live transcription</p>
                        </>
                    )}
                </motion.div>
            ) : useVirtualization ? (
                // Virtualized rendering for large lists
                <>
                    <div
                        style={{
                            height: virtualizer.getTotalSize(),
                            width: "100%",
                            position: "relative",
                        }}
                    >
                        {virtualizer.getVirtualItems().map((virtualRow) => {
                            const segment = segments[virtualRow.index];

                            return (
                                <div
                                    key={segment.id}
                                    data-index={virtualRow.index}
                                    ref={virtualizer.measureElement}
                                    style={{
                                        position: "absolute",
                                        top: 0,
                                        left: 0,
                                        width: "100%",
                                        transform: `translateY(${virtualRow.start}px)`,
                                    }}
                                    className="group"
                                >
                                    {renderSegment(segment, virtualRow.index)}
                                </div>
                            );
                        })}
                    </div>

                    {/* Infinite scroll trigger and loading indicator */}
                    {(hasMore || isLoadingMore) && !isRecording && segments.length > 0 && (
                        <div ref={loadMoreTriggerRef} className="flex justify-center items-center py-4 mt-2">
                            {isLoadingMore ? (
                                <div className="flex items-center gap-2 text-gray-500">
                                    <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                                    <span className="text-sm">Loading more...</span>
                                </div>
                            ) : hasMore && totalCount > 0 ? (
                                <span className="text-sm text-gray-400">
                                    Showing {loadedCount} of {totalCount} segments
                                </span>
                            ) : null}
                        </div>
                    )}

                    {/* Listening indicator when recording */}
                    {!isStopping && isRecording && !isPaused && !isProcessing && segments.length > 0 && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex items-center gap-2 mt-4 text-gray-500"
                        >
                            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                            <span className="text-sm">Listening...</span>
                        </motion.div>
                    )}
                </>
            ) : (
                // Simple rendering for small lists (better animations)
                <>
                    <div className="space-y-1">
                        {segments.map((segment, index) => {
                            const isStreaming = streamingSegmentId === segment.id;

                            return (
                                <motion.div
                                    key={segment.id}
                                    initial={{ opacity: 0, y: 5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.15 }}
                                    className="group"
                                >
                                    {renderSegment(segment, index)}
                                </motion.div>
                            );
                        })}
                    </div>

                    {/* Infinite scroll trigger (for small lists that grow) */}
                    {(hasMore || isLoadingMore) && !isRecording && segments.length > 0 && (
                        <div ref={loadMoreTriggerRef} className="flex justify-center items-center py-4 mt-2">
                            {isLoadingMore ? (
                                <div className="flex items-center gap-2 text-gray-500">
                                    <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                                    <span className="text-sm">Loading more...</span>
                                </div>
                            ) : hasMore && totalCount > 0 ? (
                                <span className="text-sm text-gray-400">
                                    Showing {loadedCount} of {totalCount} segments
                                </span>
                            ) : null}
                        </div>
                    )}

                    {/* Listening indicator when recording */}
                    {!isStopping && isRecording && !isPaused && !isProcessing && segments.length > 0 && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex items-center gap-2 mt-4 text-gray-500"
                        >
                            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                            <span className="text-sm">Listening...</span>
                        </motion.div>
                    )}
                </>
            )}
            </div>

            {/* Selection action bar */}
            {selectedIds.size > 0 && speakers && speakers.length > 0 && (
                <SelectionActionBar
                    count={selectedIds.size}
                    speakers={speakers}
                    onAssign={handleBulkAssign}
                    onClear={clearSelection}
                />
            )}
        </div>
    );
};
