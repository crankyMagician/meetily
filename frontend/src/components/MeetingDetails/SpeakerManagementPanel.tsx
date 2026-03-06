'use client';

import { useState, useCallback, memo } from 'react';
import { MeetingSpeaker } from '@/types';
import { SPEAKER_PALETTES, getPaletteForColor } from '@/lib/speaker-colors';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown, ChevronRight, MoreHorizontal, Plus, Sparkles, Loader2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { useConfig } from '@/contexts/ConfigContext';

interface SpeakerManagementPanelProps {
  speakers: MeetingSpeaker[];
  segmentCounts: Map<string, number>;
  unassignedCount: number;
  onRenameSpeaker: (key: string, name: string) => Promise<void>;
  onUpdateColor: (key: string, color: string) => Promise<void>;
  onAddSpeaker: (key: string, name: string, color?: string) => Promise<void>;
  onDeleteSpeaker: (key: string) => Promise<void>;
  onReassignSpeaker: (from: string, to: string) => Promise<number>;
  onRefreshSpeakers: () => Promise<void>;
  meetingId: string;
  onBulkAssignSpeaker?: (speaker: string) => void;
}

// Color picker grid
const ColorPicker = memo(function ColorPicker({
  currentColor,
  onSelect,
}: {
  currentColor: string | null;
  onSelect: (color: string) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-1.5 p-2">
      {SPEAKER_PALETTES.map(p => (
        <button
          key={p.key}
          type="button"
          onClick={() => onSelect(p.key)}
          className={`w-6 h-6 rounded-full ${p.dot} hover:ring-2 hover:ring-offset-1 hover:ring-gray-400 transition-all ${
            currentColor === p.key ? 'ring-2 ring-offset-1 ring-gray-600' : ''
          }`}
          title={p.label}
        />
      ))}
    </div>
  );
});

// Inline editable name
const EditableName = memo(function EditableName({
  name,
  onSubmit,
}: {
  name: string;
  onSubmit: (newName: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(name);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== name) {
      onSubmit(trimmed);
    }
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <input
        autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={handleSubmit}
        onKeyDown={e => {
          if (e.key === 'Enter') handleSubmit();
          if (e.key === 'Escape') { setValue(name); setIsEditing(false); }
        }}
        className="text-sm font-medium bg-surface border border-input rounded px-1 py-0 outline-none focus:border-blue-400 w-full max-w-[120px]"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setIsEditing(true)}
      className="text-sm font-medium text-foreground hover:text-blue-600 truncate max-w-[120px] text-left"
      title="Click to rename"
    >
      {name}
    </button>
  );
});

// Speaker row
const SpeakerRow = memo(function SpeakerRow({
  speaker,
  count,
  otherSpeakers,
  onRename,
  onUpdateColor,
  onDelete,
  onReassign,
}: {
  speaker: MeetingSpeaker;
  count: number;
  otherSpeakers: MeetingSpeaker[];
  onRename: (name: string) => void;
  onUpdateColor: (color: string) => void;
  onDelete: () => void;
  onReassign: (toKey: string) => void;
}) {
  const palette = getPaletteForColor(speaker.color);

  return (
    <div className="flex items-center gap-2 py-1.5 px-1 group">
      {/* Color dot (clickable for color picker) */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`w-3.5 h-3.5 rounded-full ${palette.dot} flex-shrink-0 hover:ring-2 hover:ring-offset-1 hover:ring-gray-400 cursor-pointer`}
            title="Change color"
          />
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start" sideOffset={4}>
          <ColorPicker currentColor={speaker.color} onSelect={onUpdateColor} />
        </PopoverContent>
      </Popover>

      {/* Name */}
      <div className="flex-1 min-w-0">
        <EditableName name={speaker.display_name} onSubmit={onRename} />
      </div>

      {/* Segment count */}
      <span className="text-xs text-text-placeholder flex-shrink-0 tabular-nums">{count}</span>

      {/* Actions menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-surface-tertiary transition-opacity"
          >
            <MoreHorizontal className="w-3.5 h-3.5 text-text-placeholder" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {otherSpeakers.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Merge into...</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {otherSpeakers.map(other => {
                  const otherPalette = getPaletteForColor(other.color);
                  return (
                    <DropdownMenuItem key={other.speaker_key} onClick={() => onReassign(other.speaker_key)}>
                      <span className={`w-2.5 h-2.5 rounded-full ${otherPalette.dot} mr-2 flex-shrink-0`} />
                      {other.display_name}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onDelete} className="text-red-600">
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});

export const SpeakerManagementPanel = memo(function SpeakerManagementPanel({
  speakers,
  segmentCounts,
  unassignedCount,
  onRenameSpeaker,
  onUpdateColor,
  onAddSpeaker,
  onDeleteSpeaker,
  onReassignSpeaker,
  onRefreshSpeakers,
  meetingId,
  onBulkAssignSpeaker,
}: SpeakerManagementPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [isIdentifying, setIsIdentifying] = useState(false);
  const { modelConfig } = useConfig();

  const handleAddSpeaker = useCallback(async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    // Use name as key (lowercase, spaces to underscores)
    const key = trimmed.toLowerCase().replace(/\s+/g, '_');
    await onAddSpeaker(key, trimmed);
    setNewName('');
    setIsAddingNew(false);
  }, [newName, onAddSpeaker]);

  const handleMerge = useCallback(async (fromKey: string, toKey: string) => {
    const count = await onReassignSpeaker(fromKey, toKey);
    const fromSpeaker = speakers.find(s => s.speaker_key === fromKey);
    const toSpeaker = speakers.find(s => s.speaker_key === toKey);
    toast.success(`Merged ${fromSpeaker?.display_name ?? fromKey} into ${toSpeaker?.display_name ?? toKey} (${count} segments)`);
  }, [onReassignSpeaker, speakers]);

  const handleIdentifySpeakers = useCallback(async () => {
    setIsIdentifying(true);
    try {
      const result = await invoke<{ speakers: any[]; assignments_count: number }>(
        'api_identify_and_assign_speakers',
        { meetingId, model: modelConfig.provider, modelName: modelConfig.model }
      );
      await onRefreshSpeakers();
      toast.success(`Identified ${result.speakers.length} speakers, assigned ${result.assignments_count} segments`);
    } catch (error) {
      console.error('Failed to identify speakers:', error);
      toast.error(`Speaker identification failed: ${error}`);
    } finally {
      setIsIdentifying(false);
    }
  }, [meetingId, modelConfig, onRefreshSpeakers]);

  return (
    <div className="border-b border-border-subtle">
      {/* Header - always visible */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 w-full px-1 py-1.5 text-xs text-muted-foreground hover:text-text-primary"
      >
        {isExpanded ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        <span className="font-medium">Speakers</span>
        <span className="text-text-placeholder">({speakers.length})</span>
        {unassignedCount > 0 && (
          <span className="ml-auto text-amber-600">{unassignedCount} unassigned</span>
        )}
      </button>

      {isExpanded && (
        <div className="pb-2 px-1">
          {/* Speaker list */}
          {speakers.map(speaker => (
            <SpeakerRow
              key={speaker.speaker_key}
              speaker={speaker}
              count={segmentCounts.get(speaker.speaker_key) || 0}
              otherSpeakers={speakers.filter(s => s.speaker_key !== speaker.speaker_key)}
              onRename={(name) => onRenameSpeaker(speaker.speaker_key, name)}
              onUpdateColor={(color) => onUpdateColor(speaker.speaker_key, color)}
              onDelete={() => onDeleteSpeaker(speaker.speaker_key)}
              onReassign={(toKey) => handleMerge(speaker.speaker_key, toKey)}
            />
          ))}

          {/* Unassigned bulk assign */}
          {unassignedCount > 0 && onBulkAssignSpeaker && (
            <div className="mt-1 px-1 text-xs text-muted-foreground">
              {unassignedCount} unassigned —{' '}
              {speakers.slice(0, 3).map((s, i) => {
                const palette = getPaletteForColor(s.color);
                return (
                  <span key={s.speaker_key}>
                    {i > 0 && ' | '}
                    <button
                      onClick={() => onBulkAssignSpeaker(s.speaker_key)}
                      className={`${palette.text} hover:underline`}
                    >
                      Set as {s.display_name}
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          {/* Add speaker */}
          {isAddingNew ? (
            <form
              onSubmit={e => { e.preventDefault(); handleAddSpeaker(); }}
              className="flex items-center gap-1.5 mt-1.5 px-1"
            >
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Speaker name..."
                className="flex-1 text-sm border border-border rounded px-2 py-0.5 outline-none focus:border-blue-400"
                onKeyDown={e => { if (e.key === 'Escape') { setIsAddingNew(false); setNewName(''); } }}
              />
              <button
                type="submit"
                disabled={!newName.trim()}
                className="text-xs px-2 py-0.5 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-40"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => { setIsAddingNew(false); setNewName(''); }}
                className="text-xs px-1 text-text-placeholder hover:text-text-secondary"
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-2 mt-1.5 px-1">
              <button
                type="button"
                onClick={() => setIsAddingNew(true)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-blue-600"
              >
                <Plus className="w-3 h-3" />
                Add Speaker
              </button>
              <button
                type="button"
                onClick={handleIdentifySpeakers}
                disabled={isIdentifying}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-purple-600 disabled:opacity-50 ml-auto"
                title="Use AI to identify and assign speakers"
              >
                {isIdentifying ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Sparkles className="w-3 h-3" />
                )}
                {isIdentifying ? 'Identifying...' : 'Identify Speakers'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
