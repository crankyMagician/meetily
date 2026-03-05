"use client";

import { useState, useRef, useEffect } from 'react';
import { getPaletteForColor, getPaletteForSpeakerKey } from '@/lib/speaker-colors';

interface SpeakerBadgeProps {
  name: string;
  speakerKey: string; // "mic", "system", etc.
  onRename?: (newName: string) => void;
  /** Color key from meeting_speakers table (e.g., "blue", "purple"). When provided, uses palette lookup instead of hash. */
  color?: string;
}

export function SpeakerBadge({ name, speakerKey, onRename, color }: SpeakerBadgeProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  // Use color-key palette when available, fall back to speaker-key hash
  const palette = color ? getPaletteForColor(color) : getPaletteForSpeakerKey(speakerKey);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Sync editValue when name changes externally
  useEffect(() => {
    if (!isEditing) setEditValue(name);
  }, [name, isEditing]);

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
        className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${palette.border} ${palette.bg} ${palette.text} outline-none`}
        style={{ width: `${Math.max(editValue.length, 3) * 8 + 16}px` }}
      />
    );
  }

  return (
    <span
      onClick={() => onRename && setIsEditing(true)}
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${palette.border} ${palette.bg} ${palette.text} ${onRename ? 'cursor-pointer hover:opacity-80' : ''}`}
      title={onRename ? 'Click to rename' : undefined}
    >
      {name}
    </span>
  );
}
