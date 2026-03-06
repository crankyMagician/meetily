"use client";

import { Transcript, TranscriptSegmentData, MeetingSpeaker } from '@/types';
import { VirtualizedTranscriptView } from '@/components/VirtualizedTranscriptView';
import { TranscriptButtonGroup } from './TranscriptButtonGroup';
import { SpeakerManagementPanel } from './SpeakerManagementPanel';
import { AudioPlayer } from '@/components/AudioPlayer';
import { useMemo } from 'react';

interface TranscriptPanelProps {
  transcripts: Transcript[];
  customPrompt: string;
  onPromptChange: (value: string) => void;
  onCopyTranscript: () => void;
  onOpenMeetingFolder: () => Promise<void>;
  isRecording: boolean;
  disableAutoScroll?: boolean;

  // Optional pagination props (when using virtualization)
  usePagination?: boolean;
  segments?: TranscriptSegmentData[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;

  // Speaker assignment
  onSpeakerChange?: (segmentId: string, newSpeaker: string | null) => void;
  onBulkAssignSpeaker?: (speaker: string) => void;

  // Speaker management
  speakers?: MeetingSpeaker[];
  speakerSegmentCounts?: Map<string, number>;
  getSpeakerDisplay?: (key: string | undefined) => { name: string; color: string };
  onRenameSpeaker?: (key: string, name: string) => Promise<void>;
  onUpdateSpeakerColor?: (key: string, color: string) => Promise<void>;
  onAddSpeaker?: (key: string, name: string, color?: string) => Promise<void>;
  onDeleteSpeaker?: (key: string) => Promise<void>;
  onReassignSpeaker?: (from: string, to: string) => Promise<number>;
  onRefreshSpeakers?: () => Promise<void>;
  onBulkAssignSelected?: (segmentIds: string[], speaker: string) => void;
  meetingId?: string;

  // Audio playback
  audioIsPlaying?: boolean;
  audioCurrentTime?: number;
  audioDuration?: number;
  audioError?: string | null;
  onAudioPlay?: () => void;
  onAudioPause?: () => void;
  onAudioSeek?: (time: number) => void;
  onPlaySegment?: (startTime: number) => void;

  // Review mode
  isReviewMode?: boolean;
  onStartReview?: () => void;
  onStopReview?: () => void;
  onReviewAssignSpeaker?: (speaker: string) => void;
  onReviewSkipSegment?: () => void;
}

export function TranscriptPanel({
  transcripts,
  customPrompt,
  onPromptChange,
  onCopyTranscript,
  onOpenMeetingFolder,
  isRecording,
  disableAutoScroll = false,
  usePagination = false,
  segments,
  hasMore,
  isLoadingMore,
  totalCount,
  loadedCount,
  onLoadMore,
  onSpeakerChange,
  onBulkAssignSpeaker,
  // Speaker management
  speakers,
  speakerSegmentCounts,
  getSpeakerDisplay,
  onRenameSpeaker,
  onUpdateSpeakerColor,
  onAddSpeaker,
  onDeleteSpeaker,
  onReassignSpeaker,
  onRefreshSpeakers,
  onBulkAssignSelected,
  meetingId,
  // Audio
  audioIsPlaying = false,
  audioCurrentTime = 0,
  audioDuration = 0,
  audioError,
  onAudioPlay,
  onAudioPause,
  onAudioSeek,
  onPlaySegment,
  // Review
  isReviewMode = false,
  onStartReview,
  onStopReview,
  onReviewAssignSpeaker,
  onReviewSkipSegment,
}: TranscriptPanelProps) {
  // Convert transcripts to segments if pagination is not used but we want virtualization
  const convertedSegments = useMemo(() => {
    if (usePagination && segments) {
      return segments;
    }
    // Convert transcripts to segments for virtualization
    return transcripts.map(t => ({
      id: t.id,
      timestamp: t.audio_start_time ?? 0,
      endTime: t.audio_end_time,
      text: t.text,
      confidence: t.confidence,
      speaker: t.speaker,
    }));
  }, [transcripts, usePagination, segments]);

  // Count unassigned segments
  const unassignedCount = useMemo(() =>
    convertedSegments.filter(s => !s.speaker).length,
    [convertedSegments]
  );

  const showAudioPlayer = !isRecording && convertedSegments.length > 0 && onAudioPlay;

  const hasSpeakerManagement = speakers && onRenameSpeaker && onUpdateSpeakerColor && onAddSpeaker && onDeleteSpeaker && onReassignSpeaker && onRefreshSpeakers && meetingId;

  return (
    <div className="hidden md:flex md:w-1/4 lg:w-1/3 min-w-0 border-r border-border bg-surface flex-col relative shrink-0">
      {/* Title area */}
      <div className="p-4 border-b border-border">
        <TranscriptButtonGroup
          transcriptCount={usePagination ? (totalCount ?? convertedSegments.length) : (transcripts?.length || 0)}
          onCopyTranscript={onCopyTranscript}
          onOpenMeetingFolder={onOpenMeetingFolder}
        />
      </div>

      {/* Speaker management panel */}
      {hasSpeakerManagement && (
        <div className="px-4 pt-2">
          <SpeakerManagementPanel
            speakers={speakers}
            segmentCounts={speakerSegmentCounts || new Map()}
            unassignedCount={unassignedCount}
            onRenameSpeaker={onRenameSpeaker}
            onUpdateColor={onUpdateSpeakerColor}
            onAddSpeaker={onAddSpeaker}
            onDeleteSpeaker={onDeleteSpeaker}
            onReassignSpeaker={onReassignSpeaker}
            onRefreshSpeakers={onRefreshSpeakers}
            meetingId={meetingId}
            onBulkAssignSpeaker={onBulkAssignSpeaker}
          />
        </div>
      )}

      {/* Legacy bulk assign fallback (when no speaker management) */}
      {!hasSpeakerManagement && onBulkAssignSpeaker && unassignedCount > 0 && (
        <div className="px-4 mt-2 text-xs text-muted-foreground">
          {unassignedCount} unassigned —{' '}
          <button
            onClick={() => onBulkAssignSpeaker('mic')}
            className="text-blue-600 hover:underline"
          >
            Set as You
          </button>
          {' | '}
          <button
            onClick={() => onBulkAssignSpeaker('system')}
            className="text-purple-600 hover:underline"
          >
            Set as Other
          </button>
        </div>
      )}

      {/* Transcript content - use virtualized view for better performance */}
      <div className="flex-1 overflow-hidden">
        <VirtualizedTranscriptView
          segments={convertedSegments}
          isRecording={isRecording}
          isPaused={false}
          isProcessing={false}
          isStopping={false}
          enableStreaming={false}
          showConfidence={true}
          disableAutoScroll={disableAutoScroll}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          totalCount={totalCount}
          loadedCount={loadedCount}
          onLoadMore={onLoadMore}
          onSpeakerChange={onSpeakerChange}
          currentPlaybackTime={audioCurrentTime}
          isAudioPlaying={audioIsPlaying}
          onPlaySegment={onPlaySegment}
          speakers={speakers}
          getSpeakerDisplay={getSpeakerDisplay}
          onBulkAssignSelected={onBulkAssignSelected}
        />
      </div>

      {/* Custom prompt input at bottom of transcript section */}
      {!isRecording && convertedSegments.length > 0 && (
        <div className="p-1 border-t border-border">
          <textarea
            placeholder="Add context for AI summary. For example people involved, meeting overview, objective etc..."
            className="w-full px-3 py-2 border border-border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-surface shadow-sm min-h-[80px] resize-y"
            value={customPrompt}
            onChange={(e) => onPromptChange(e.target.value)}
          />
        </div>
      )}

      {/* Audio player bar */}
      {showAudioPlayer && (
        <AudioPlayer
          isPlaying={audioIsPlaying}
          currentTime={audioCurrentTime}
          duration={audioDuration}
          error={audioError ?? null}
          onPlay={onAudioPlay!}
          onPause={onAudioPause!}
          onSeek={onAudioSeek!}
          unassignedCount={unassignedCount}
          isReviewMode={isReviewMode}
          onStartReview={onStartReview}
          onStopReview={onStopReview}
          onAssignSpeaker={onReviewAssignSpeaker}
          onSkipSegment={onReviewSkipSegment}
          speakers={speakers}
        />
      )}
    </div>
  );
}
