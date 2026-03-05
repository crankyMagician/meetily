import { describe, expect, it } from 'vitest';
import {
  SPEAKER_PALETTES,
  DEFAULT_SPEAKER_COLORS,
  getNextAvailableColor,
  getPaletteForColor,
  getPaletteForSpeakerKey,
} from './speaker-colors';

// ── SPEAKER_PALETTES tests ────────────────────────────────────────

describe('SPEAKER_PALETTES', () => {
  it('has 12 palettes', () => {
    expect(SPEAKER_PALETTES).toHaveLength(12);
  });

  it('all palettes have required fields', () => {
    for (const p of SPEAKER_PALETTES) {
      expect(p).toHaveProperty('key');
      expect(p).toHaveProperty('label');
      expect(p).toHaveProperty('bg');
      expect(p).toHaveProperty('text');
      expect(p).toHaveProperty('border');
      expect(p).toHaveProperty('dot');
      expect(p).toHaveProperty('hex');
    }
  });

  it('all palette keys are unique', () => {
    const keys = SPEAKER_PALETTES.map(p => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('bg classes follow tailwind pattern', () => {
    for (const p of SPEAKER_PALETTES) {
      expect(p.bg).toBe(`bg-${p.key}-50`);
    }
  });
});

// ── DEFAULT_SPEAKER_COLORS tests ──────────────────────────────────

describe('DEFAULT_SPEAKER_COLORS', () => {
  it('mic is blue', () => {
    expect(DEFAULT_SPEAKER_COLORS.mic).toBe('blue');
  });

  it('system is purple', () => {
    expect(DEFAULT_SPEAKER_COLORS.system).toBe('purple');
  });
});

// ── getNextAvailableColor tests ───────────────────────────────────

describe('getNextAvailableColor', () => {
  it('returns first color when none used', () => {
    expect(getNextAvailableColor([])).toBe('blue');
  });

  it('skips used colors', () => {
    expect(getNextAvailableColor(['blue'])).toBe('purple');
  });

  it('skips multiple used', () => {
    expect(getNextAvailableColor(['blue', 'purple'])).toBe('red');
  });

  it('cycles when all used', () => {
    const all = SPEAKER_PALETTES.map(p => p.key);
    const result = getNextAvailableColor(all);
    // When all 12 are used, cycles via length % 12 → index 0 → 'blue'
    expect(SPEAKER_PALETTES.map(p => p.key)).toContain(result);
  });

  it('handles non-palette colors in used list', () => {
    // 'nonexistent' is not a palette key, so blue is still available
    expect(getNextAvailableColor(['nonexistent'])).toBe('blue');
  });
});

// ── getPaletteForColor tests ──────────────────────────────────────

describe('getPaletteForColor', () => {
  it('returns correct palette for known key', () => {
    const palette = getPaletteForColor('purple');
    expect(palette.key).toBe('purple');
  });

  it('returns blue fallback for null', () => {
    const palette = getPaletteForColor(null);
    expect(palette.key).toBe('blue');
  });

  it('returns blue fallback for undefined', () => {
    const palette = getPaletteForColor(undefined);
    expect(palette.key).toBe('blue');
  });

  it('returns blue fallback for unknown key', () => {
    const palette = getPaletteForColor('nonexistent');
    expect(palette.key).toBe('blue');
  });
});

// ── getPaletteForSpeakerKey tests ─────────────────────────────────

describe('getPaletteForSpeakerKey', () => {
  it('mic returns blue palette', () => {
    const palette = getPaletteForSpeakerKey('mic');
    expect(palette.key).toBe('blue');
  });

  it('system returns purple palette', () => {
    const palette = getPaletteForSpeakerKey('system');
    expect(palette.key).toBe('purple');
  });

  it('custom name returns deterministic palette', () => {
    const p1 = getPaletteForSpeakerKey('alice');
    const p2 = getPaletteForSpeakerKey('alice');
    expect(p1.key).toBe(p2.key);
  });

  it('different names can map to different palettes', () => {
    const p1 = getPaletteForSpeakerKey('alice');
    const p2 = getPaletteForSpeakerKey('bob');
    // Both should be valid palettes (they might or might not differ)
    expect(SPEAKER_PALETTES.map(p => p.key)).toContain(p1.key);
    expect(SPEAKER_PALETTES.map(p => p.key)).toContain(p2.key);
  });

  it('empty string returns valid palette', () => {
    const palette = getPaletteForSpeakerKey('');
    expect(SPEAKER_PALETTES.map(p => p.key)).toContain(palette.key);
  });

  it('long string returns valid palette', () => {
    const longStr = 'a'.repeat(10000);
    const palette = getPaletteForSpeakerKey(longStr);
    expect(SPEAKER_PALETTES.map(p => p.key)).toContain(palette.key);
  });

  it('hash is stable across calls', () => {
    const key = 'test-speaker-key-123';
    const r1 = getPaletteForSpeakerKey(key);
    const r2 = getPaletteForSpeakerKey(key);
    expect(r1).toEqual(r2);
  });
});
