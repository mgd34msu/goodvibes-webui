/**
 * wake-config.ts — `voice.wake.*` as this surface resolves it.
 *
 * The daemon's `config.get` answers the WHOLE config tree as nested objects; the
 * SDK's `resolveWakeRuntimeSettings` reads FLAT dotted keys. This is the adapter
 * between them, plus the one honest statement of what a browser tab can do.
 *
 * The capability answers are all `false` and none of them is a guess:
 *   - speexAvailable — the flag means "this surface APPLIES the speex stage", and no
 *     surface does: the platform ships no libspeexdsp bindings, so
 *     `voice.wake.noiseSuppression: "speex"` BLOCKS everywhere rather than being
 *     silently skipped, and `none` is the only value that runs. This is not a
 *     browser-only limitation.
 *   - vadAvailable — no VAD model is pinned by the manifest on any surface.
 *   - canRetainAudio — a tab has no filesystem to retain a clip to.
 *   - canPlayLocalFile — a tab cannot read an absolute path on the user's machine,
 *     so a custom activation sound downgrades to the built-in chime.
 *
 * The resolver turns the last two into `limitations` (the detector still runs and
 * says which row is not in force) and the first two into `blockers` (the detector
 * does not start). Only `.active` decides whether a device is opened.
 */
import {
  resolveWakeRuntimeSettings,
  wakeSurfaceKey,
  type WakeRuntimeSettings,
  type WakeSettingReader,
  type WakeSurfaceCapabilities,
} from '@pellux/goodvibes-sdk/platform/voice/wake/runtime';
import { asRecord } from '../object';

/** The surface id this tab resolves `voice.wake.surfaces.*` under. */
export const WAKE_SURFACE = 'webui' as const;

/** The `voice.wake.surfaces.webui` key, from the SDK rather than spelled again. */
export const WAKE_SURFACE_KEY = wakeSurfaceKey(WAKE_SURFACE);

/** What a browser tab can actually do. See this file's header for each answer. */
export const WEBUI_WAKE_CAPABILITIES: WakeSurfaceCapabilities = {
  speexAvailable: false,
  vadAvailable: false,
  canRetainAudio: false,
  canPlayLocalFile: false,
};

/**
 * Read a dotted path out of a `config.get` tree.
 *
 * Returns undefined for anything the tree does not hold, which is exactly what
 * the resolver wants: it then applies the shipped default rather than a zero, so
 * a partial tree resolves to shipped behaviour instead of a disabled detector
 * with every threshold at 0.
 */
export function configPathReader(tree: unknown): WakeSettingReader {
  return (key: string): unknown => {
    const segments = key.split('.');
    let cursor: unknown = tree;
    for (const segment of segments) {
      if (cursor === null || typeof cursor !== 'object') return undefined;
      cursor = asRecord(cursor)[segment];
      if (cursor === undefined) return undefined;
    }
    return cursor;
  };
}

/** Resolve every `voice.wake.*` row for this tab from a `config.get` tree. */
export function resolveWebuiWakeSettings(tree: unknown): WakeRuntimeSettings {
  return resolveWakeRuntimeSettings(configPathReader(tree), WAKE_SURFACE, WEBUI_WAKE_CAPABILITIES);
}
