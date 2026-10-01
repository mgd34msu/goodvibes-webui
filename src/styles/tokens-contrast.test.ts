/**
 * WCAG contrast for every text token against every surface it is used on, read
 * straight from src/styles/tokens.css for the dark (default), light and neon
 * themes (design doc "Accessibility": body text passes 4.5:1 on its surface in
 * every theme; --text-3 is metadata only and passes 3:1).
 *
 * Surfaces: --canvas, --sidebar, --surface, --surface-2, and --glass taken as
 * opaque (its color without the alpha; the blur behind it is not modeled).
 * Any other translucent value (neon's sidebar and surface-2) is composited
 * over --canvas, which is what sits behind it.
 *
 * Thresholds:
 *   --text, --text-2 ..................... 4.5 on every surface
 *   --text-3 ............................. 3 on every surface (metadata only)
 *   --primary-fg on --primary-bg ......... 4.5 (primary and send buttons)
 *   --on-accent on --accent .............. 4.5 (the rare text on an accent fill)
 *   --accent ............................. 4.5 on canvas, surface and glass (links);
 *                                          3 on sidebar and surface-2 (focus ring,
 *                                          selection marker: non-text)
 *   --ok --warn --bad --info ............. 4.5 on canvas, surface and glass (status
 *                                          words and error lines); 3 on sidebar and
 *                                          surface-2 (dots inside chips and rows)
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Rgba = readonly [number, number, number, number];
type Tokens = Record<string, string>;

const CSS = readFileSync(join(import.meta.dir, 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The custom properties declared in the first block opened by `selector`. */
function block(selector: string): Tokens {
  const start = CSS.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`tokens.css has no block for ${selector}`);
  const open = CSS.indexOf('{', start);
  const close = CSS.indexOf('}', open);
  const tokens: Tokens = {};
  for (const match of CSS.slice(open + 1, close).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[match[1]] = match[2].trim();
  }
  return tokens;
}

/** Light and neon override the dark root; anything they leave out is inherited. */
const DARK = block(':root');
const THEMES: Record<string, Tokens> = {
  dark: DARK,
  light: { ...DARK, ...block(':root[data-theme="light"]') },
  neon: { ...DARK, ...block(':root[data-theme="neon"]') },
};

function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[/,]\s*([\d.]+)(%?))?\s*\)$/i.exec(value);
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]) / (rgb[5] === '%' ? 100 : 1);
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), alpha];
  }
  throw new Error(`not a color this test understands: ${value}`);
}

function over(color: Rgba, backdrop: Rgba): Rgba {
  const mix = (i: 0 | 1 | 2) => color[i] * color[3] + backdrop[i] * (1 - color[3]);
  return [mix(0), mix(1), mix(2), 1];
}

function luminance([r, g, b]: Rgba): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** A token resolved to an opaque color: --glass drops its alpha, other translucent values sit on --canvas. */
function resolve(tokens: Tokens, name: string): Rgba {
  const raw = tokens[name];
  if (raw === undefined) throw new Error(`token ${name} is not defined`);
  const color = parseColor(raw);
  if (color[3] >= 1) return color;
  if (name === '--glass') return [color[0], color[1], color[2], 1];
  return over(color, resolve(tokens, '--canvas'));
}

const ALL_SURFACES = ['--canvas', '--sidebar', '--surface', '--surface-2', '--glass'] as const;
const TEXT_SURFACES = ['--canvas', '--surface', '--glass'] as const;
const MARK_SURFACES = ['--sidebar', '--surface-2'] as const;

interface Pair { fg: string; bg: string; min: number }

const PAIRS: Pair[] = [
  ...['--text', '--text-2'].flatMap((fg) => ALL_SURFACES.map((bg) => ({ fg, bg, min: 4.5 }))),
  ...ALL_SURFACES.map((bg) => ({ fg: '--text-3', bg, min: 3 })),
  { fg: '--primary-fg', bg: '--primary-bg', min: 4.5 },
  { fg: '--on-accent', bg: '--accent', min: 4.5 },
  ...['--accent', '--ok', '--warn', '--bad', '--info'].flatMap((fg) => [
    ...TEXT_SURFACES.map((bg) => ({ fg, bg, min: 4.5 })),
    ...MARK_SURFACES.map((bg) => ({ fg, bg, min: 3 })),
  ]),
];

describe('token contrast (WCAG 2.1)', () => {
  for (const [theme, tokens] of Object.entries(THEMES)) {
    describe(theme, () => {
      for (const { fg, bg, min } of PAIRS) {
        test(`${fg} on ${bg} is at least ${min}:1`, () => {
          const value = ratio(resolve(tokens, fg), resolve(tokens, bg));
          expect(Number(value.toFixed(2)), `${theme}: ${fg} (${tokens[fg]}) on ${bg} (${tokens[bg]})`).toBeGreaterThanOrEqual(min);
        });
      }
    });
  }

  test('the ratio math matches the WCAG reference points', () => {
    expect(ratio(parseColor('#000000'), parseColor('#ffffff'))).toBeCloseTo(21, 5);
    expect(ratio(parseColor('#777777'), parseColor('#ffffff'))).toBeCloseTo(4.48, 2);
  });

  test('the auto theme under a light OS preference carries exactly the light colors', () => {
    const auto = block(':root[data-theme="auto"]');
    const light = block(':root[data-theme="light"]');
    for (const name of Object.keys(auto)) expect(`${name}: ${auto[name]}`).toBe(`${name}: ${light[name]}`);
    expect(Object.keys(auto).length).toBeGreaterThan(10);
  });
});
