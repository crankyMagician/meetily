import { useState, useEffect, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { MeetingSpeaker, SpeakerSegmentCount } from '@/types';
import { getPaletteForColor, getPaletteForSpeakerKey, getNextAvailableColor } from '@/lib/speaker-colors';

interface UseSpeakersOptions {
  meetingId: string;
}

export interface UseSpeakersReturn {
  speakers: MeetingSpeaker[];
  segmentCounts: Map<string, number>;
  isLoading: boolean;
  renameSpeaker: (key: string, name: string) => Promise<void>;
  updateColor: (key: string, color: string) => Promise<void>;
  addSpeaker: (key: string, name: string, color?: string) => Promise<void>;
  deleteSpeaker: (key: string) => Promise<void>;
  reassignSpeaker: (from: string, to: string) => Promise<number>;
  refreshSpeakers: () => Promise<void>;
  getSpeakerDisplay: (key: string | undefined) => { name: string; color: string };
  speakerMap: Map<string, MeetingSpeaker>;
}

export function useSpeakers({ meetingId }: UseSpeakersOptions): UseSpeakersReturn {
  const [speakers, setSpeakers] = useState<MeetingSpeaker[]>([]);
  const [segmentCounts, setSegmentCounts] = useState<Map<string, number>>(new Map());
  const [isLoading, setIsLoading] = useState(true);

  const speakerMap = useMemo(
    () => new Map(speakers.map(s => [s.speaker_key, s])),
    [speakers]
  );

  const loadSpeakers = useCallback(async () => {
    try {
      const result = await invoke<MeetingSpeaker[]>('api_ensure_meeting_speakers', { meetingId });
      setSpeakers(result);
    } catch (error) {
      console.error('Failed to load speakers:', error);
    }
  }, [meetingId]);

  const loadSegmentCounts = useCallback(async () => {
    try {
      const counts = await invoke<SpeakerSegmentCount[]>('api_get_speaker_segment_counts', { meetingId });
      const map = new Map<string, number>();
      for (const c of counts) {
        map.set(c.speaker, c.count);
      }
      setSegmentCounts(map);
    } catch (error) {
      console.error('Failed to load segment counts:', error);
    }
  }, [meetingId]);

  const refreshSpeakers = useCallback(async () => {
    await Promise.all([loadSpeakers(), loadSegmentCounts()]);
  }, [loadSpeakers, loadSegmentCounts]);

  // Initial load
  useEffect(() => {
    setIsLoading(true);
    refreshSpeakers().finally(() => setIsLoading(false));
  }, [refreshSpeakers]);

  const renameSpeaker = useCallback(async (key: string, name: string) => {
    // Optimistic update
    setSpeakers(prev => prev.map(s =>
      s.speaker_key === key ? { ...s, display_name: name } : s
    ));
    try {
      await invoke('api_set_speaker_name', { meetingId, speakerKey: key, displayName: name });
    } catch (error) {
      console.error('Failed to rename speaker:', error);
      await loadSpeakers(); // Revert
    }
  }, [meetingId, loadSpeakers]);

  const updateColor = useCallback(async (key: string, color: string) => {
    setSpeakers(prev => prev.map(s =>
      s.speaker_key === key ? { ...s, color } : s
    ));
    try {
      await invoke('api_update_speaker_color', { meetingId, speakerKey: key, color });
    } catch (error) {
      console.error('Failed to update color:', error);
      await loadSpeakers();
    }
  }, [meetingId, loadSpeakers]);

  const addSpeaker = useCallback(async (key: string, name: string, color?: string) => {
    const usedColors = speakers.filter(s => s.color).map(s => s.color!);
    const finalColor = color || getNextAvailableColor(usedColors);
    try {
      const newSpeaker = await invoke<MeetingSpeaker>('api_add_speaker', {
        meetingId, speakerKey: key, displayName: name, color: finalColor,
      });
      setSpeakers(prev => [...prev, newSpeaker]);
    } catch (error) {
      console.error('Failed to add speaker:', error);
    }
  }, [meetingId, speakers]);

  const deleteSpeaker = useCallback(async (key: string) => {
    setSpeakers(prev => prev.filter(s => s.speaker_key !== key));
    try {
      await invoke('api_delete_speaker', { meetingId, speakerKey: key });
    } catch (error) {
      console.error('Failed to delete speaker:', error);
      await loadSpeakers();
    }
  }, [meetingId, loadSpeakers]);

  const reassignSpeaker = useCallback(async (from: string, to: string): Promise<number> => {
    try {
      const count = await invoke<number>('api_reassign_speaker', {
        meetingId, fromSpeaker: from, toSpeaker: to,
      });
      // Remove old speaker, refresh counts
      setSpeakers(prev => prev.filter(s => s.speaker_key !== from));
      await loadSegmentCounts();
      return count;
    } catch (error) {
      console.error('Failed to reassign speaker:', error);
      await refreshSpeakers();
      return 0;
    }
  }, [meetingId, loadSegmentCounts, refreshSpeakers]);

  const getSpeakerDisplay = useCallback((key: string | undefined): { name: string; color: string } => {
    if (!key) return { name: 'Unassigned', color: 'blue' };

    const speaker = speakerMap.get(key);
    if (speaker) {
      return {
        name: speaker.display_name,
        color: speaker.color || getPaletteForSpeakerKey(key).key,
      };
    }

    // Fallback for known keys
    if (key === 'mic') return { name: 'You', color: 'blue' };
    if (key === 'system') return { name: 'Other', color: 'purple' };
    return { name: key, color: getPaletteForSpeakerKey(key).key };
  }, [speakerMap]);

  return {
    speakers,
    segmentCounts,
    isLoading,
    renameSpeaker,
    updateColor,
    addSpeaker,
    deleteSpeaker,
    reassignSpeaker,
    refreshSpeakers,
    getSpeakerDisplay,
    speakerMap,
  };
}
