/**
 * VoiceSettings — covers the shared voice popover's local-voice setup section
 * (voice.local.status / voice.local.install, SDK 1.9.0-dev's memory-relay-voice-
 * hardening work): checking/unavailable/error/provisioned/unsupported-platform/
 * not-provisioned (setup action, size-labeled)/install-progress/install-receipt
 * (with and without a retriable failure) states.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let mockVoiceStatus: unknown = {
  enabled: true,
  ttsAvailable: false,
  sttAvailable: false,
  providers: [],
  note: '',
};
let mockVoiceConfig: unknown = { provider: '', voice: '' };

mock.module('../../lib/voice/useVoice', () => ({
  useVoiceStatus: () => ({ availability: mockVoiceStatus, isLoading: false }),
  useSharedVoiceConfig: () => ({ config: mockVoiceConfig, isLoading: false }),
}));

mock.module('../../lib/goodvibes', () => ({
  invokeMethod: () => Promise.resolve({}),
  sdk: {
    operator: {
      voice: {
        voices: () => Promise.resolve({ voices: [] }),
      },
    },
  },
}));

let mockLocalStatus: {
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error?: unknown;
  data?: unknown;
} = { isPending: false, isError: false, isSuccess: false, data: undefined };

let localInstallMutateCalls = 0;
let mockLocalInstall: { isPending: boolean; isError: boolean; isSuccess: boolean; error?: unknown; data?: unknown; mutate: () => void } = {
  isPending: false,
  isError: false,
  isSuccess: false,
  data: undefined,
  mutate: () => { localInstallMutateCalls += 1; },
};

mock.module('../../hooks/useVoiceLocalSetup', () => ({
  useVoiceLocalStatus: () => mockLocalStatus,
  useVoiceLocalInstall: () => mockLocalInstall,
}));

const { VoiceSettings } = await import('./VoiceSettings');

function render(): { el: HTMLElement; unmount: () => void } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(VoiceSettings)));
  });
  return {
    el: container,
    unmount: () => {
      flushSync(() => { root.unmount(); });
      if (container.parentNode) container.parentNode.removeChild(container);
    },
  };
}

function openPopover(el: HTMLElement): void {
  const trigger = el.querySelector('.voice-settings-btn') as HTMLButtonElement;
  flushSync(() => { trigger.click(); });
}

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  mockVoiceStatus = { enabled: true, ttsAvailable: false, sttAvailable: false, providers: [], note: '' };
  mockVoiceConfig = { provider: '', voice: '' };
  mockLocalStatus = { isPending: false, isError: false, isSuccess: false, data: undefined };
  localInstallMutateCalls = 0;
  mockLocalInstall = { isPending: false, isError: false, isSuccess: false, data: undefined, mutate: () => { localInstallMutateCalls += 1; } };
});

const NOT_PROVISIONED_STATUS = {
  platform: 'linux-x64',
  state: 'not-provisioned',
  tts: { engine: 'piper', binaryPresent: false, voicePresent: false, binaryPath: '/x/piper', modelPath: '/x/voice.onnx' },
  stt: {
    engine: 'whisper-cpp',
    supported: true,
    state: 'not-provisioned',
    binaryPresent: false,
    modelPresent: false,
    binaryPath: '/x/whisper',
    modelPath: '/x/model.bin',
  },
  offerBytes: 209_715_200,
};

describe('VoiceSettings — local voice setup', () => {
  test('the local section is not rendered until the popover opens', () => {
    const { el, unmount } = render();
    cleanup = unmount;
    expect(el.querySelector('[data-testid="voice-settings-local"]')).toBeNull();
  });

  test('loading state shows a checking hint', () => {
    mockLocalStatus = { isPending: true, isError: false, isSuccess: false, data: undefined };
    const { el, unmount } = render();
    cleanup = unmount;
    openPopover(el);
    expect(el.textContent).toContain('Checking local voice…');
  });

  test('unavailable (404 METHOD_NOT_FOUND) skips the section entirely — no error banner for a capability the daemon never heard of', () => {
    mockLocalStatus = {
      isPending: false,
      isError: true,
      isSuccess: false,
      error: Object.assign(new Error('Unknown gateway method'), { status: 404, code: 'METHOD_NOT_FOUND' }),
      data: undefined,
    };
    const { el, unmount } = render();
    cleanup = unmount;
    openPopover(el);
    expect(el.querySelector('[data-testid="voice-settings-local"]')).toBeNull();
  });

  test('unavailable (501) also skips the section entirely', () => {
    mockLocalStatus = {
      isPending: false,
      isError: true,
      isSuccess: false,
      error: Object.assign(new Error('not wired'), { status: 501 }),
      data: undefined,
    };
    const { el, unmount } = render();
    cleanup = unmount;
    openPopover(el);
    expect(el.querySelector('[data-testid="voice-settings-local"]')).toBeNull();
  });

  test('a genuine fetch error renders the honest retriable-looking message, distinct from unavailable', () => {
    mockLocalStatus = {
      isPending: false,
      isError: true,
      isSuccess: false,
      error: Object.assign(new Error('network down'), { status: 0, category: 'network' }),
      data: undefined,
    };
    const { el, unmount } = render();
    cleanup = unmount;
    openPopover(el);
    expect(el.querySelector('[data-testid="voice-settings-local"]')).not.toBeNull();
    expect(el.textContent).toContain('Local voice status unavailable');
  });

  test('provisioned state shows a quiet installed confirmation, no setup button', () => {
    mockLocalStatus = {
      isPending: false,
      isError: false,
      isSuccess: true,
      data: {
        ...NOT_PROVISIONED_STATUS,
        state: 'provisioned',
        tts: { ...NOT_PROVISIONED_STATUS.tts, binaryPresent: true, voicePresent: true },
        stt: { ...NOT_PROVISIONED_STATUS.stt, binaryPresent: true, modelPresent: true },
      },
    };
    const { el, unmount } = render();
    cleanup = unmount;
    openPopover(el);
    expect(el.textContent).toContain('Installed — TTS: piper, STT: whisper-cpp.');
    const buttons = Array.from(el.querySelectorAll('[data-testid="voice-settings-local"] button')).map((b) => b.textContent);
    expect(buttons.some((t) => t?.includes('Set up local voice'))).toBe(false);
  });

  test('unsupported-platform state shows the honest note, no setup button', () => {
    mockLocalStatus = {
      isPending: false,
      isError: false,
      isSuccess: true,
      data: { ...NOT_PROVISIONED_STATUS, state: 'unsupported-platform', offerBytes: null },
    };
    const { el, unmount } = render();
    cleanup = unmount;
    openPopover(el);
    expect(el.textContent).toContain('Not supported on this platform — no pinned engine build exists for this host.');
    const buttons = Array.from(el.querySelectorAll('[data-testid="voice-settings-local"] button')).map((b) => b.textContent);
    expect(buttons.some((t) => t?.includes('Set up local voice'))).toBe(false);
  });

  test('not-provisioned state shows a size-labeled setup action that invokes install on click', () => {
    mockLocalStatus = { isPending: false, isError: false, isSuccess: true, data: NOT_PROVISIONED_STATUS };
    const { el, unmount } = render();
    cleanup = unmount;
    openPopover(el);
    const button = Array.from(el.querySelectorAll('[data-testid="voice-settings-local"] button'))
      .find((b) => b.textContent?.includes('Set up local voice')) as HTMLButtonElement;
    expect(button).toBeDefined();
    expect(button.textContent).toContain('200.0 MB');
    flushSync(() => { button.click(); });
    expect(localInstallMutateCalls).toBe(1);
  });

  test('partial state also offers the setup action', () => {
    mockLocalStatus = { isPending: false, isError: false, isSuccess: true, data: { ...NOT_PROVISIONED_STATUS, state: 'partial' } };
    const { el, unmount } = render();
    cleanup = unmount;
    openPopover(el);
    const button = Array.from(el.querySelectorAll('[data-testid="voice-settings-local"] button'))
      .find((b) => b.textContent?.includes('Set up local voice'));
    expect(button).toBeDefined();
  });

  test('installing shows a busy label on the button', () => {
    mockLocalStatus = { isPending: false, isError: false, isSuccess: true, data: NOT_PROVISIONED_STATUS };
    mockLocalInstall = { ...mockLocalInstall, isPending: true };
    const { el, unmount } = render();
    cleanup = unmount;
    openPopover(el);
    expect(el.textContent).toContain('Installing…');
  });

  test('a fully-successful install renders both engine outcomes and no retry button', () => {
    mockLocalStatus = { isPending: false, isError: false, isSuccess: true, data: NOT_PROVISIONED_STATUS };
    mockLocalInstall = {
      ...mockLocalInstall,
      isSuccess: true,
      data: {
        provisioned: true,
        platform: 'linux-x64',
        tts: { engine: 'piper', state: 'provisioned', binaryPath: '/x/piper', modelPath: '/x/voice.onnx' },
        stt: { engine: 'whisper-cpp', state: 'provisioned', binaryPath: '/x/whisper', modelPath: '/x/model.bin' },
        components: [],
        configured: { set: [{ key: 'tts.provider', value: 'local' }], skipped: [] },
      },
    };
    const { el, unmount } = render();
    cleanup = unmount;
    openPopover(el);
    expect(el.textContent).toContain('TTS (piper): Installed');
    expect(el.textContent).toContain('STT (whisper-cpp): Installed');
    expect(el.textContent).toContain('Configured: tts.provider');
    const retry = Array.from(el.querySelectorAll('[data-testid="voice-settings-local"] button')).find((b) => b.textContent === 'Retry');
    expect(retry).toBeUndefined();
  });

  test('a retriable engine failure (download-failed) shows the reason and a Retry action that re-invokes install', () => {
    mockLocalStatus = { isPending: false, isError: false, isSuccess: true, data: NOT_PROVISIONED_STATUS };
    mockLocalInstall = {
      ...mockLocalInstall,
      isSuccess: true,
      data: {
        provisioned: false,
        platform: 'linux-x64',
        tts: { engine: 'piper', state: 'download-failed', reason: 'network timeout fetching piper.tar.gz' },
        stt: { engine: 'whisper-cpp', state: 'not-provisioned' as never },
        components: [{ id: 'piper-engine', state: 'failed', error: 'network timeout' }],
        configured: { set: [], skipped: [] },
      },
    };
    const { el, unmount } = render();
    cleanup = unmount;
    openPopover(el);
    expect(el.textContent).toContain('TTS (piper): Download failed — network timeout fetching piper.tar.gz');
    const retry = Array.from(el.querySelectorAll('[data-testid="voice-settings-local"] button')).find((b) => b.textContent === 'Retry') as HTMLButtonElement;
    expect(retry).toBeDefined();
    flushSync(() => { retry.click(); });
    expect(localInstallMutateCalls).toBe(1);
  });

  test('a non-retriable engine failure (bundle-unavailable) shows the reason with no Retry action', () => {
    mockLocalStatus = { isPending: false, isError: false, isSuccess: true, data: NOT_PROVISIONED_STATUS };
    mockLocalInstall = {
      ...mockLocalInstall,
      isSuccess: true,
      data: {
        provisioned: false,
        platform: 'darwin-arm64',
        tts: { engine: 'piper', state: 'provisioned' },
        stt: { engine: 'whisper-cpp', state: 'bundle-unavailable', reason: 'no pinned whisper.cpp bundle exists for this platform yet' },
        components: [],
        configured: { set: [], skipped: [] },
      },
    };
    const { el, unmount } = render();
    cleanup = unmount;
    openPopover(el);
    expect(el.textContent).toContain('STT (whisper-cpp): Not yet published for this platform — no pinned whisper.cpp bundle exists for this platform yet');
    const retry = Array.from(el.querySelectorAll('[data-testid="voice-settings-local"] button')).find((b) => b.textContent === 'Retry');
    expect(retry).toBeUndefined();
  });

  test('the install receipt survives the resting-state flip to provisioned (the refetch after a successful install)', () => {
    mockLocalStatus = {
      isPending: false,
      isError: false,
      isSuccess: true,
      data: {
        ...NOT_PROVISIONED_STATUS,
        state: 'provisioned',
        tts: { ...NOT_PROVISIONED_STATUS.tts, binaryPresent: true, voicePresent: true },
        stt: { ...NOT_PROVISIONED_STATUS.stt, state: 'provisioned', binaryPresent: true, modelPresent: true },
      },
    };
    mockLocalInstall = {
      ...mockLocalInstall,
      isSuccess: true,
      data: {
        provisioned: true,
        platform: 'linux-x64',
        tts: { engine: 'piper', state: 'provisioned' },
        stt: { engine: 'whisper-cpp', state: 'provisioned' },
        components: [],
        configured: { set: [{ key: 'tts.provider', value: 'local' }], skipped: [] },
      },
    };
    const { el, unmount } = render();
    cleanup = unmount;
    openPopover(el);
    // Both the fresh resting line AND the receipt are visible — the receipt never
    // vanishes the instant the invalidated status query answers.
    expect(el.textContent).toContain('Installed — TTS: piper, STT: whisper-cpp.');
    expect(el.textContent).toContain('TTS (piper): Installed');
    expect(el.textContent).toContain('Configured: tts.provider');
    const buttons = Array.from(el.querySelectorAll('[data-testid="voice-settings-local"] button')).map((b) => b.textContent);
    expect(buttons.some((t) => t?.includes('Set up local voice'))).toBe(false);
  });

  test('an install mutation error renders the formatted error text', () => {
    mockLocalStatus = { isPending: false, isError: false, isSuccess: true, data: NOT_PROVISIONED_STATUS };
    mockLocalInstall = { ...mockLocalInstall, isError: true, error: new Error('daemon unreachable') };
    const { el, unmount } = render();
    cleanup = unmount;
    openPopover(el);
    expect(el.textContent).toContain('daemon unreachable');
  });
});
