"use client";

import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { MeetingContextType } from '@/types';

const CONTEXT_OPTIONS: MeetingContextType[] = [
  'Sales Call',
  'Interview',
  'Team Standup',
  '1-on-1',
  'Personal',
  'Brainstorm',
  'Presentation',
  'Custom',
];

interface MeetingContextSelectorProps {
  meetingId: string;
  initialContextType?: string | null;
  initialContextNotes?: string | null;
  compact?: boolean;
  onChange?: (contextType: string | null, contextNotes: string | null) => void;
}

export function MeetingContextSelector({
  meetingId,
  initialContextType = null,
  initialContextNotes = null,
  compact = false,
  onChange,
}: MeetingContextSelectorProps) {
  const [contextType, setContextType] = useState<string | null>(initialContextType);
  const [contextNotes, setContextNotes] = useState<string>(initialContextNotes || '');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setContextType(initialContextType);
    setContextNotes(initialContextNotes || '');
  }, [initialContextType, initialContextNotes]);

  const handleSave = async (type: string | null, notes: string) => {
    setIsSaving(true);
    try {
      await invoke('api_save_meeting_context', {
        meetingId,
        contextType: type,
        contextNotes: notes || null,
      });
      onChange?.(type, notes || null);
    } catch (error) {
      console.error('Failed to save meeting context:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTypeChange = (value: string) => {
    const newType = value === '' ? null : value;
    setContextType(newType);
    handleSave(newType, contextNotes);
  };

  const handleNotesBlur = () => {
    handleSave(contextType, contextNotes);
  };

  if (compact) {
    return (
      <select
        value={contextType || ''}
        onChange={(e) => handleTypeChange(e.target.value)}
        className="text-xs px-2 py-1 border border-gray-200 rounded-md bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-400"
        disabled={isSaving}
      >
        <option value="">Meeting type...</option>
        {CONTEXT_OPTIONS.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-gray-500">Meeting Type</label>
        <select
          value={contextType || ''}
          onChange={(e) => handleTypeChange(e.target.value)}
          className="text-sm px-2 py-1 border border-gray-200 rounded-md bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
          disabled={isSaving}
        >
          <option value="">Select type...</option>
          {CONTEXT_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
      {contextType && (
        <textarea
          value={contextNotes}
          onChange={(e) => setContextNotes(e.target.value)}
          onBlur={handleNotesBlur}
          placeholder="Add context notes (e.g., Q4 pipeline review with enterprise prospect)"
          className="w-full text-sm px-3 py-2 border border-gray-200 rounded-md bg-white text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
          rows={2}
          disabled={isSaving}
        />
      )}
    </div>
  );
}
