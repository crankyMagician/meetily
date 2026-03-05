'use client';

import { memo } from 'react';
import { Play, Pause, Volume2, VolumeX } from 'lucide-react';
import { MeetingSpeaker } from '@/types';
import { getPaletteForColor } from '@/lib/speaker-colors';

interface AudioPlayerProps {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  error: string | null;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (time: number) => void;
  // Review mode
  unassignedCount?: number;
  isReviewMode?: boolean;
  onStartReview?: () => void;
  onStopReview?: () => void;
  onAssignSpeaker?: (speaker: string) => void;
  onSkipSegment?: () => void;
  // Dynamic speakers
  speakers?: MeetingSpeaker[];
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export const AudioPlayer = memo(function AudioPlayer({
  isPlaying,
  currentTime,
  duration,
  error,
  onPlay,
  onPause,
  onSeek,
  unassignedCount = 0,
  isReviewMode = false,
  onStartReview,
  onStopReview,
  onAssignSpeaker,
  onSkipSegment,
  speakers,
}: AudioPlayerProps) {
  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 border-t border-gray-200 bg-gray-50 text-gray-400 text-xs">
        <VolumeX className="w-4 h-4" />
        <span>No audio available</span>
      </div>
    );
  }

  if (duration === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 border-t border-gray-200 bg-gray-50 text-gray-400 text-xs">
        <Volume2 className="w-4 h-4 animate-pulse" />
        <span>Loading audio...</span>
      </div>
    );
  }

  // Review mode UI
  if (isReviewMode) {
    // Use dynamic speaker list if available, otherwise fallback to You/Other
    const speakerButtons = speakers && speakers.length > 0 ? speakers : null;

    return (
      <div className="border-t border-gray-200 bg-blue-50 px-3 py-2 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={isPlaying ? onPause : onPlay}
              className="p-1 rounded hover:bg-blue-100 transition-colors"
            >
              {isPlaying ? <Pause className="w-4 h-4 text-blue-600" /> : <Play className="w-4 h-4 text-blue-600" />}
            </button>
            <span className="text-xs font-medium text-blue-700">
              Reviewing unassigned ({unassignedCount} left)
            </span>
          </div>
          <button
            onClick={onStopReview}
            className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
          >
            Stop Review
          </button>
        </div>
        <div className="flex items-center gap-2">
          {speakerButtons ? (
            speakerButtons.map(s => {
              const palette = getPaletteForColor(s.color);
              return (
                <button
                  key={s.speaker_key}
                  onClick={() => onAssignSpeaker?.(s.speaker_key)}
                  className={`flex-1 py-1.5 px-3 text-sm font-medium rounded transition-colors border ${palette.border} ${palette.bg} ${palette.text} hover:opacity-80`}
                >
                  {s.display_name}
                </button>
              );
            })
          ) : (
            <>
              <button
                onClick={() => onAssignSpeaker?.('mic')}
                className="flex-1 py-1.5 px-3 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
              >
                You
              </button>
              <button
                onClick={() => onAssignSpeaker?.('system')}
                className="flex-1 py-1.5 px-3 bg-purple-600 text-white text-sm font-medium rounded hover:bg-purple-700 transition-colors"
              >
                Other
              </button>
            </>
          )}
          <button
            onClick={onSkipSegment}
            className="py-1.5 px-3 text-sm text-gray-500 hover:text-gray-700 hover:underline"
          >
            Skip
          </button>
        </div>
      </div>
    );
  }

  // Normal player UI
  return (
    <div className="border-t border-gray-200 bg-gray-50 px-3 py-2 space-y-1">
      <div className="flex items-center gap-2">
        <button
          onClick={isPlaying ? onPause : onPlay}
          className="p-1 rounded hover:bg-gray-200 transition-colors flex-shrink-0"
        >
          {isPlaying ? <Pause className="w-4 h-4 text-gray-700" /> : <Play className="w-4 h-4 text-gray-700" />}
        </button>
        <span className="text-xs text-gray-500 min-w-[36px] tabular-nums">{formatTime(currentTime)}</span>
        <input
          type="range"
          min={0}
          max={duration}
          step={0.1}
          value={currentTime}
          onChange={(e) => onSeek(parseFloat(e.target.value))}
          className="flex-1 h-1 bg-gray-300 rounded-full appearance-none cursor-pointer accent-blue-600 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-600 [&::-webkit-slider-thumb]:appearance-none"
        />
        <span className="text-xs text-gray-500 min-w-[36px] tabular-nums">{formatTime(duration)}</span>
      </div>
      {unassignedCount > 0 && onStartReview && (
        <div className="flex justify-center">
          <button
            onClick={onStartReview}
            className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
          >
            Review {unassignedCount} unassigned segments
          </button>
        </div>
      )}
    </div>
  );
});
