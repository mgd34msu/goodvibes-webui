/**
 * Voice routes for the hermetic harness — layered on top of installChatMockDaemon.
 *
 * Answers voice.status / voice.voices.list / voice.tts.stream / voice.stt and config.get
 * in-page, so the voice surface exercises every honest state with NO real voice provider
 * and NO real network. Audio is faked two ways: the TTS stream returns throwaway bytes,
 * and an injected fake AudioContext (installFakeAudio) decodes/plays them without touching
 * real audio hardware — the tests assert the STATES, never real sound.
 *
 * Registered AFTER the chat mock's '**\/api\/**' catch-all, so these more specific
 * handlers win for the voice/config paths.
 */
import type { Page, Route } from '@playwright/test';
import { voiceLocalInstallResponse, voiceLocalStatusResponse } from './mock-daemon';

export interface VoiceProviderSeed {
  id: string;
  label: string;
  configured: boolean;
  capabilities: string[];
}

export interface VoiceMockOptions {
  /** Providers voice.status reports. Default: a configured ElevenLabs (tts + stt). */
  providers?: VoiceProviderSeed[];
  /** The transcript voice.stt returns. Default 'hello from voice input'. */
  transcript?: string;
  /** Shared tts.provider/tts.voice config.get reports. */
  ttsProvider?: string;
  ttsVoice?: string;
  /**
   * voice.local.status's resting state (SDK 1.9.0-dev's managed provisioning).
   * Default 'not-provisioned' (the size-labeled setup offer). 'unavailable' answers
   * the honest 404 of an older daemon build (the section stays absent entirely).
   */
  localRuntime?: 'not-provisioned' | 'provisioned' | 'unsupported-platform' | 'unavailable';
  /** The voice.local.install receipt outcome. Default 'provisioned' (flips the
   * resting state, exactly like the real one-act flow). */
  localInstallOutcome?: 'provisioned' | 'download-failed';
}

export interface VoiceMock {
  ttsRequests: { body: unknown }[];
  sttRequests: { body: unknown }[];
  configWrites: { key: unknown; value: unknown }[];
  localInstallRequests: number;
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });
}

const DEFAULT_PROVIDERS: VoiceProviderSeed[] = [
  { id: 'elevenlabs', label: 'ElevenLabs', configured: true, capabilities: ['tts', 'tts-stream', 'stt', 'voice-list'] },
];

/** Inject a fake AudioContext so the Web Audio player runs deterministically with no real
 * decoding or hardware. decodeAudioData always resolves; a scheduled source "ends" after a
 * generous delay so the playing/Stop state is observable and interruptible. */
export async function installFakeAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class FakeAudioContext {
      currentTime = 0;
      destination = {};
      decodeAudioData() {
        return Promise.resolve({ duration: 1.5 });
      }
      createBufferSource() {
        const source: {
          buffer: unknown;
          onended: (() => void) | null;
          connect: () => void;
          start: () => void;
          stop: () => void;
        } = {
          buffer: null,
          onended: null,
          connect: () => undefined,
          start: () => {
            setTimeout(() => source.onended?.(), 1500);
          },
          stop: () => {
            source.onended = null;
          },
        };
        return source;
      }
      resume() {
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test shim
    (window as any).AudioContext = FakeAudioContext;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test shim
    (window as any).webkitAudioContext = FakeAudioContext;
  });
}

export async function installVoiceRoutes(page: Page, options: VoiceMockOptions = {}): Promise<VoiceMock> {
  const providers = options.providers ?? DEFAULT_PROVIDERS;
  const transcript = options.transcript ?? 'hello from voice input';
  const ttsProvider = options.ttsProvider ?? 'elevenlabs';
  const ttsVoice = options.ttsVoice ?? 'rachel';
  const mock: VoiceMock = { ttsRequests: [], sttRequests: [], configWrites: [], localInstallRequests: 0 };

  // voice.local.status / voice.local.install in-memory state — install flips the
  // resting state to provisioned (unless seeded to the retriable download failure,
  // which keeps nothing), exactly like the real one-act flow.
  const localRuntime = options.localRuntime ?? 'not-provisioned';
  let voiceLocalState = localRuntime === 'unavailable'
    ? null
    : localRuntime === 'unsupported-platform'
      ? {
          ...voiceLocalStatusResponse(),
          platform: null,
          state: 'unsupported-platform' as const,
          stt: { ...voiceLocalStatusResponse().stt, supported: false, state: 'unsupported-platform' as const },
          offerBytes: null,
        }
      : localRuntime === 'provisioned'
        ? {
            ...voiceLocalStatusResponse(),
            state: 'provisioned' as const,
            tts: { ...voiceLocalStatusResponse().tts, binaryPresent: true, voicePresent: true },
            stt: { ...voiceLocalStatusResponse().stt, state: 'provisioned' as const, binaryPresent: true, modelPresent: true },
          }
        : voiceLocalStatusResponse();

  // config.get / config.set live at /config (no /api segment).
  await page.route('**/config', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = (request.postDataJSON?.() ?? {}) as { key?: unknown; value?: unknown };
      mock.configWrites.push({ key: body.key, value: body.value });
      return json(route, { success: true, key: body.key, value: body.value });
    }
    return json(route, {
      ui: { voiceEnabled: true },
      tts: { provider: ttsProvider, voice: ttsVoice, speed: 1 },
    });
  });

  await page.route('**/api/voice**', async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;

    // Managed local voice (voice.local.status / voice.local.install, SDK 1.9.0-dev).
    if (method === 'GET' && path === '/api/voice/local/status') {
      if (!voiceLocalState) return json(route, { error: 'Unknown gateway method', code: 'METHOD_NOT_FOUND' }, 404);
      return json(route, voiceLocalState);
    }
    if (method === 'POST' && path === '/api/voice/local/install') {
      if (!voiceLocalState) return json(route, { error: 'Unknown gateway method', code: 'METHOD_NOT_FOUND' }, 404);
      mock.localInstallRequests += 1;
      const receipt = voiceLocalInstallResponse(options.localInstallOutcome ?? 'provisioned');
      if (receipt.provisioned) {
        voiceLocalState = {
          ...voiceLocalState,
          state: 'provisioned',
          tts: { ...voiceLocalState.tts, binaryPresent: true, voicePresent: true },
          stt: { ...voiceLocalState.stt, state: 'provisioned', binaryPresent: true, modelPresent: true },
        };
      }
      return json(route, receipt);
    }

    if (method === 'GET' && path === '/api/voice') {
      return json(route, {
        enabled: true,
        providerCount: providers.length,
        providers: providers.map((p) => ({
          id: p.id,
          label: p.label,
          state: p.configured ? 'healthy' : 'unconfigured',
          capabilities: p.capabilities,
          configured: p.configured,
          metadata: {},
        })),
        note: 'Voice capture is intentionally external to the SDK host process.',
      });
    }
    if (method === 'GET' && path === '/api/voice/providers') {
      return json(route, { providers: providers.map((p) => ({ id: p.id, label: p.label, capabilities: p.capabilities })) });
    }
    if (method === 'GET' && path === '/api/voice/voices') {
      return json(route, {
        voices: [
          { id: 'rachel', label: 'Rachel', metadata: {} },
          { id: 'adam', label: 'Adam', metadata: {} },
        ],
      });
    }
    if (method === 'POST' && path === '/api/voice/tts/stream') {
      mock.ttsRequests.push({ body: request.postDataJSON?.() });
      // Throwaway bytes — the fake AudioContext ignores their content.
      return route.fulfill({
        status: 200,
        contentType: 'audio/mpeg',
        headers: { 'access-control-allow-origin': '*' },
        body: Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x00, 0x00]),
      });
    }
    if (method === 'POST' && path === '/api/voice/stt') {
      mock.sttRequests.push({ body: request.postDataJSON?.() });
      return json(route, { providerId: providers[0]?.id ?? 'elevenlabs', text: transcript, metadata: {} });
    }
    return json(route, {});
  });

  return mock;
}
