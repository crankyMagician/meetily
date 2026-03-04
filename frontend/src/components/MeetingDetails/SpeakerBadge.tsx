"use client";

import { useState, useRef, useEffect } from 'react';

interface SpeakerBadgeProps {
  name: string;
  speakerKey: string; // "mic", "system", etc.
  onRename?: (newName: string) => void;
}

const SPEAKER_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  mic: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  system: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  system_speaker_1: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  system_speaker_2: { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200' },
  system_speaker_3: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
};

const DEFAULT_COLOR = { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200' };

export function SpeakerBadge({ name, speakerKey, onRename }: SpeakerBadgeProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  const colors = SPEAKER_COLORS[speakerKey] || DEFAULT_COLOR;

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSubmit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== name && onRename) {
      onRename(trimmed);
    }
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSubmit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit();
          if (e.key === 'Escape') { setEditValue(name); setIsEditing(false); }
        }}
        className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${colors.border} ${colors.bg} ${colors.text} outline-none`}
        style={{ width: `${Math.max(editValue.length, 3) * 8 + 16}px` }}
      />
    );
  }

  return (
    <span
      onClick={() => onRename && setIsEditing(true)}
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${colors.border} ${colors.bg} ${colors.text} ${onRename ? 'cursor-pointer hover:opacity-80' : ''}`}
      title={onRename ? 'Click to rename' : undefined}
    >
      {name}
    </span>
  );
}
