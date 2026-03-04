'use client';

import { useCallback, useRef, useReducer, startTransition, useEffect, useState, memo, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import { useTranscriptStreaming } from "@/hooks/useTranscriptStreaming";
import { ConfidenceIndicator } from "./ConfidenceIndicator";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { RecordingStatusBar } from "./RecordingStatusBar";
import { motion, AnimatePresence } from "framer-motion";
import { TranscriptSegmentData } from "@/types";
import { SpeakerBadge } from "./MeetingDetails/SpeakerBadge";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Play } from "lucide-react";

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
}

// Threshold for enabling virtualization (below this, use simple rendering)
const VIRTUALIZATION_THRESHOLD = 10;

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

// Speaker assignment popover component
const SpeakerPopover = memo(function SpeakerPopover({
    speaker,
    speakerLabel,
    onSelect,
}: {
    speaker?: string;
    speakerLabel?: string;
    onSelect: (value: string | null) => void;
}) {
    const [open, setOpen] = useState(false);
    const [customName, setCustomName] = useState('');

    const handleSelect = (value: string | null) => {
        onSelect(value);
        setOpen(false);
        setCustomName('');
    };

    const handleCustomSubmit = () => {
        const trimmed = customName.trim();
        if (trimmed) {
            handleSelect(trimmed);
        }
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                {speaker && speakerLabel ? (
                    <button type="button" className="cursor-pointer" title="Click to change speaker">
                        <SpeakerBadge name={speakerLabel} speakerKey={speaker} />
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
            </PopoverTrigger>
            <PopoverContent className="w-48 p-2" align="start" sideOffset={4}>
                <div className="flex flex-col gap-1">
                    <button
                        type="button"
                        onClick={() => handleSelect('mic')}
                        className={`text-left px-2 py-1.5 rounded text-sm hover:bg-gray-100 ${speaker === 'mic' ? 'bg-gray-100 font-medium' : ''}`}
                    >
                        You
                    </button>
                    <button
                        type="button"
                        onClick={() => handleSelect('system')}
                        className={`text-left px-2 py-1.5 rounded text-sm hover:bg-gray-100 ${speaker === 'system' ? 'bg-gray-100 font-medium' : ''}`}
                    >
                        Other
                    </button>
                    <div className="border-t border-gray-200 my-1" />
                    <form
                        onSubmit={(e) => { e.preventDefault(); handleCustomSubmit(); }}
                        className="flex gap-1"
                    >
                        <input
                            type="text"
                            value={customName}
                            onChange={(e) => setCustomName(e.target.value)}
                            placeholder="Custom name..."
                            className="flex-1 px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:border-blue-400"
                            autoFocus
                        />
                        <button
                            type="submit"
                            disabled={!customName.trim()}
                            className="px-2 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            Set
                        </button>
                    </form>
                    <div className="border-t border-gray-200 my-1" />
                    <button
                        type="button"
                        onClick={() => handleSelect(null)}
                        className="text-left px-2 py-1.5 rounded text-sm text-gray-500 hover:bg-gray-100"
                    >
                        Unassign
                    </button>
                </div>
            </PopoverContent>
        </Popover>
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
}) {
    const displayText = cleanStopWords(text) || (text.trim() === '' ? '[Silence]' : text);
    const speakerLabel = speaker === 'mic' ? 'You' : speaker === 'system' ? 'Other' : speaker;

    return (
        <div
            id={`segment-${id}`}
            className={`mb-3 ${isActive ? 'border-l-2 border-blue-500 bg-blue-50/50 pl-1 -ml-1' : ''}`}
        >
            <div className="flex items-start gap-2">
                <Tooltip>
                    <TooltipTrigger>
                        {onPlayClick ? (
                            <button
                                onClick={() => onPlayClick(timestamp)}
                                className="text-xs text-gray-400 mt-1 flex-shrink-0 min-w-[50px] hover:text-blue-600 group flex items-center gap-0.5"
                            >
                                <Play className="w-3 h-3 hidden group-hover:inline-block" />
                                <span className="group-hover:text-blue-600">{formatRecordingTime(timestamp)}</span>
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
                {onSpeakerChange ? (
                    <SpeakerPopover
                        speaker={speaker}
                        speakerLabel={speakerLabel || undefined}
                        onSelect={(value) => onSpeakerChange(id, value)}
                    />
                ) : speaker && speakerLabel ? (
                    <SpeakerBadge name={speakerLabel} speakerKey={speaker} />
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
}) => {
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

    return (
        <div ref={scrollRef} className="flex flex-col h-full overflow-y-auto px-4 py-2">
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
                            const isStreaming = streamingSegmentId === segment.id;

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
                                >
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
                                    />
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
                        {segments.map((segment) => {
                            const isStreaming = streamingSegmentId === segment.id;

                            return (
                                <motion.div
                                    key={segment.id}
                                    initial={{ opacity: 0, y: 5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.15 }}
                                >
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
                                    />
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
        </div>
    );
};
