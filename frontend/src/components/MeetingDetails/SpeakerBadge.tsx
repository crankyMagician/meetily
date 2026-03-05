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

// Full Tailwind class literals so they survive CSS purging
const CUSTOM_PALETTES: { bg: string; text: string; border: string }[] = [
  { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
  { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200' },
  { bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200' },
  { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200' },
  { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200' },
  { bg: 'bg-lime-50', text: 'text-lime-700', border: 'border-lime-200' },
  { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
  { bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200' },
  { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200' },
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getColorForSpeaker(key: string): { bg: string; text: string; border: string } {
  if (SPEAKER_COLORS[key]) return SPEAKER_COLORS[key];
  return CUSTOM_PALETTES[hashString(key) % CUSTOM_PALETTES.length];
}

export function SpeakerBadge({ name, speakerKey, onRename }: SpeakerBadgeProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  const colors = getColorForSpeaker(speakerKey);

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
