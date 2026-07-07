/**
 * Manifest validity + honesty guard.
 *
 * The PWA is installable only if the manifest is well-formed and declares the
 * right icons + display mode. And its theme/background color must be the SAME
 * color the app actually paints its chrome (tokens.css --surface-base, dark
 * default) — a manifest color that drifted from the real UI would flash a
 * different color on the install splash and status bar than the app shows,
 * which is a small dishonesty. This test fails if either drifts.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'public', 'manifest.webmanifest'), 'utf8')) as {
  name: string;
  short_name: string;
  display: string;
  start_url: string;
  scope: string;
  theme_color: string;
  background_color: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
};

function firstSurfaceBase(): string {
  const css = readFileSync(join(REPO_ROOT, 'src', 'styles', 'tokens.css'), 'utf8');
  const match = css.match(/--surface-base:\s*(#[0-9a-fA-F]{3,8})/);
  if (!match) throw new Error('could not find --surface-base in tokens.css');
  return match[1].toLowerCase();
}

describe('web app manifest', () => {
  test('declares an installable standalone app with a rooted scope', () => {
    expect(manifest.name.length).toBeGreaterThan(0);
    expect(manifest.short_name.length).toBeGreaterThan(0);
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url.startsWith('/')).toBe(true);
    expect(manifest.scope).toBe('/');
  });

  test('ships a 192, a 512, and a maskable icon', () => {
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith('/icons/')).toBe(true);
      expect(icon.type).toBe('image/png');
    }
  });

  test('theme/background color match the app chrome (tokens.css --surface-base)', () => {
    const surfaceBase = firstSurfaceBase();
    expect(manifest.theme_color.toLowerCase()).toBe(surfaceBase);
    expect(manifest.background_color.toLowerCase()).toBe(surfaceBase);
  });
});

describe('index.html links the manifest and PWA metas', () => {
  const html = readFileSync(join(REPO_ROOT, 'index.html'), 'utf8');
  test('links the manifest, a theme-color, and the apple app-capable metas', () => {
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('manifest.webmanifest');
    expect(html).toContain('name="theme-color"');
    expect(html).toContain('apple-mobile-web-app-capable');
  });
  test('the theme-color meta matches the manifest theme_color', () => {
    const meta = html.match(/name="theme-color"\s+content="(#[0-9a-fA-F]{3,8})"/);
    expect(meta).not.toBeNull();
    expect(meta?.[1].toLowerCase()).toBe(manifest.theme_color.toLowerCase());
  });
});
