/**
 * Centralized speaker color palette system.
 * Full Tailwind class literals so they survive CSS purging.
 */

export interface SpeakerColorPalette {
  key: string;
  label: string;
  bg: string;
  text: string;
  border: string;
  dot: string;
  hex: string;
  darkBg: string;
  darkText: string;
  darkBorder: string;
}

// All 12 palettes with full Tailwind class literals (light + dark)
export const SPEAKER_PALETTES: SpeakerColorPalette[] = [
  { key: 'blue',    label: 'Blue',    bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200',    dot: 'bg-blue-500',    hex: '#3b82f6',  darkBg: 'dark:bg-blue-950',    darkText: 'dark:text-blue-300',    darkBorder: 'dark:border-blue-800' },
  { key: 'purple',  label: 'Purple',  bg: 'bg-purple-50',  text: 'text-purple-700',  border: 'border-purple-200',  dot: 'bg-purple-500',  hex: '#a855f7',  darkBg: 'dark:bg-purple-950',  darkText: 'dark:text-purple-300',  darkBorder: 'dark:border-purple-800' },
  { key: 'red',     label: 'Red',     bg: 'bg-red-50',     text: 'text-red-700',     border: 'border-red-200',     dot: 'bg-red-500',     hex: '#ef4444',  darkBg: 'dark:bg-red-950',     darkText: 'dark:text-red-300',     darkBorder: 'dark:border-red-800' },
  { key: 'green',   label: 'Green',   bg: 'bg-green-50',   text: 'text-green-700',   border: 'border-green-200',   dot: 'bg-green-500',   hex: '#22c55e',  darkBg: 'dark:bg-green-950',   darkText: 'dark:text-green-300',   darkBorder: 'dark:border-green-800' },
  { key: 'amber',   label: 'Amber',   bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',   dot: 'bg-amber-500',   hex: '#f59e0b',  darkBg: 'dark:bg-amber-950',   darkText: 'dark:text-amber-300',   darkBorder: 'dark:border-amber-800' },
  { key: 'pink',    label: 'Pink',    bg: 'bg-pink-50',    text: 'text-pink-700',    border: 'border-pink-200',    dot: 'bg-pink-500',    hex: '#ec4899',  darkBg: 'dark:bg-pink-950',    darkText: 'dark:text-pink-300',    darkBorder: 'dark:border-pink-800' },
  { key: 'indigo',  label: 'Indigo',  bg: 'bg-indigo-50',  text: 'text-indigo-700',  border: 'border-indigo-200',  dot: 'bg-indigo-500',  hex: '#6366f1',  darkBg: 'dark:bg-indigo-950',  darkText: 'dark:text-indigo-300',  darkBorder: 'dark:border-indigo-800' },
  { key: 'cyan',    label: 'Cyan',    bg: 'bg-cyan-50',    text: 'text-cyan-700',    border: 'border-cyan-200',    dot: 'bg-cyan-500',    hex: '#06b6d4',  darkBg: 'dark:bg-cyan-950',    darkText: 'dark:text-cyan-300',    darkBorder: 'dark:border-cyan-800' },
  { key: 'emerald', label: 'Emerald', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500', hex: '#10b981',  darkBg: 'dark:bg-emerald-950', darkText: 'dark:text-emerald-300', darkBorder: 'dark:border-emerald-800' },
  { key: 'rose',    label: 'Rose',    bg: 'bg-rose-50',    text: 'text-rose-700',    border: 'border-rose-200',    dot: 'bg-rose-500',    hex: '#f43f5e',  darkBg: 'dark:bg-rose-950',    darkText: 'dark:text-rose-300',    darkBorder: 'dark:border-rose-800' },
  { key: 'teal',    label: 'Teal',    bg: 'bg-teal-50',    text: 'text-teal-700',    border: 'border-teal-200',    dot: 'bg-teal-500',    hex: '#14b8a6',  darkBg: 'dark:bg-teal-950',    darkText: 'dark:text-teal-300',    darkBorder: 'dark:border-teal-800' },
  { key: 'violet',  label: 'Violet',  bg: 'bg-violet-50',  text: 'text-violet-700',  border: 'border-violet-200',  dot: 'bg-violet-500',  hex: '#8b5cf6',  darkBg: 'dark:bg-violet-950',  darkText: 'dark:text-violet-300',  darkBorder: 'dark:border-violet-800' },
];

const paletteMap = new Map(SPEAKER_PALETTES.map(p => [p.key, p]));

/** Default color assignments for known speaker keys */
export const DEFAULT_SPEAKER_COLORS: Record<string, string> = {
  mic: 'blue',
  system: 'purple',
};

/** Get the next available color not yet used */
export function getNextAvailableColor(usedColors: string[]): string {
  const usedSet = new Set(usedColors);
  for (const palette of SPEAKER_PALETTES) {
    if (!usedSet.has(palette.key)) return palette.key;
  }
  return SPEAKER_PALETTES[usedColors.length % SPEAKER_PALETTES.length].key;
}

/** Get palette for a given color key, with fallback */
export function getPaletteForColor(colorKey: string | null | undefined): SpeakerColorPalette {
  if (colorKey && paletteMap.has(colorKey)) {
    return paletteMap.get(colorKey)!;
  }
  // Fallback: use hash-based selection for backward compat
  return SPEAKER_PALETTES[0]; // blue default
}

/** Hash-based palette selection for backward compat (when no color is stored) */
export function getPaletteForSpeakerKey(speakerKey: string): SpeakerColorPalette {
  // Check known defaults first
  if (DEFAULT_SPEAKER_COLORS[speakerKey]) {
    return getPaletteForColor(DEFAULT_SPEAKER_COLORS[speakerKey]);
  }
  // Hash for custom names
  let hash = 0;
  for (let i = 0; i < speakerKey.length; i++) {
    hash = ((hash << 5) - hash + speakerKey.charCodeAt(i)) | 0;
  }
  return SPEAKER_PALETTES[Math.abs(hash) % SPEAKER_PALETTES.length];
}

/** Get themed class strings from a palette (combines light + dark classes) */
export function getThemedClasses(palette: SpeakerColorPalette): { bg: string; text: string; border: string } {
  return {
    bg: `${palette.bg} ${palette.darkBg}`,
    text: `${palette.text} ${palette.darkText}`,
    border: `${palette.border} ${palette.darkBorder}`,
  };
}
