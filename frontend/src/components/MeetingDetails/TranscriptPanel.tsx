"use client";

import { Transcript, TranscriptSegmentData } from '@/types';
import { TranscriptView } from '@/components/TranscriptView';
import { VirtualizedTranscriptView } from '@/components/VirtualizedTranscriptView';
import { TranscriptButtonGroup } from './TranscriptButtonGroup';
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

  return (
    <div className="hidden md:flex md:w-1/4 lg:w-1/3 min-w-0 border-r border-gray-200 bg-white flex-col relative shrink-0">
      {/* Title area */}
      <div className="p-4 border-b border-gray-200">
        <TranscriptButtonGroup
          transcriptCount={usePagination ? (totalCount ?? convertedSegments.length) : (transcripts?.length || 0)}
          onCopyTranscript={onCopyTranscript}
          onOpenMeetingFolder={onOpenMeetingFolder}
        />
        {onBulkAssignSpeaker && unassignedCount > 0 && (
          <div className="mt-2 text-xs text-gray-500">
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
      </div>

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
        />
      </div>

      {/* Custom prompt input at bottom of transcript section */}
      {!isRecording && convertedSegments.length > 0 && (
        <div className="p-1 border-t border-gray-200">
          <textarea
            placeholder="Add context for AI summary. For example people involved, meeting overview, objective etc..."
            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm min-h-[80px] resize-y"
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
        />
      )}
    </div>
  );
}
