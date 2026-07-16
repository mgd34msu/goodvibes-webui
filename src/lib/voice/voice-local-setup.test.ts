import { describe, expect, test } from 'bun:test';
import {
  readVoiceLocalInstallResult,
  readVoiceLocalStatus,
  voiceLocalInstallIsRetriable,
  voiceLocalInstallStateLabel,
  voiceLocalNeedsSetup,
  voiceLocalStateLabel,
  type VoiceLocalStatusSnapshot,
} from './voice-local-setup';

function status(overrides: Partial<VoiceLocalStatusSnapshot> = {}): VoiceLocalStatusSnapshot {
  return {
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
    offerBytes: 200_000_000,
    ...overrides,
  };
}

describe('voiceLocalNeedsSetup', () => {
  test('offers setup for not-provisioned and partial', () => {
    expect(voiceLocalNeedsSetup(status({ state: 'not-provisioned' }))).toBe(true);
    expect(voiceLocalNeedsSetup(status({ state: 'partial' }))).toBe(true);
  });

  test('does not offer setup once provisioned', () => {
    expect(voiceLocalNeedsSetup(status({ state: 'provisioned' }))).toBe(false);
  });

  test('does not offer setup on an unsupported platform (no pinned build to install)', () => {
    expect(voiceLocalNeedsSetup(status({ state: 'unsupported-platform' }))).toBe(false);
  });
});

describe('voiceLocalStateLabel', () => {
  test('gives a human label for every resting state', () => {
    expect(voiceLocalStateLabel('provisioned')).toBe('Installed');
    expect(voiceLocalStateLabel('partial')).toBe('Partially installed');
    expect(voiceLocalStateLabel('not-provisioned')).toBe('Not set up');
    expect(voiceLocalStateLabel('unsupported-platform')).toBe('Not supported on this platform');
  });
});

describe('voiceLocalInstallStateLabel', () => {
  test('gives a human label for every install-attempt terminal state', () => {
    expect(voiceLocalInstallStateLabel('provisioned')).toBe('Installed');
    expect(voiceLocalInstallStateLabel('unsupported-platform')).toBe('Not supported on this platform');
    expect(voiceLocalInstallStateLabel('download-failed')).toBe('Download failed');
    expect(voiceLocalInstallStateLabel('checksum-mismatch')).toBe('Checksum mismatch');
    expect(voiceLocalInstallStateLabel('bundle-unavailable')).toBe('Not yet published for this platform');
    expect(voiceLocalInstallStateLabel('sideload-mismatch')).toBe('Sideloaded file does not match the pinned build');
  });
});

describe('readVoiceLocalStatus — defensive wire parse', () => {
  test('a full schema-shaped payload parses verbatim', () => {
    const parsed = readVoiceLocalStatus(status());
    expect(parsed).not.toBeNull();
    expect(parsed?.state).toBe('not-provisioned');
    expect(parsed?.stt.engine).toBe('whisper-cpp');
    expect(parsed?.offerBytes).toBe(200_000_000);
  });

  test('a 200-with-empty-body answer parses to null (honest cannot-read), never an undefined label', () => {
    expect(readVoiceLocalStatus({})).toBeNull();
    expect(readVoiceLocalStatus(null)).toBeNull();
    expect(readVoiceLocalStatus([])).toBeNull();
  });

  test('an unknown state value parses to null rather than an invented state', () => {
    expect(readVoiceLocalStatus(status({ state: 'installing' as never }))).toBeNull();
  });

  test('per-engine detail degrades field by field without sinking the snapshot', () => {
    const parsed = readVoiceLocalStatus({ state: 'provisioned' });
    expect(parsed).not.toBeNull();
    expect(parsed?.tts.engine).toBe('piper');
    expect(parsed?.stt.state).toBe('not-provisioned');
    expect(parsed?.offerBytes).toBeNull();
  });
});

describe('readVoiceLocalInstallResult — defensive wire parse', () => {
  const RECEIPT = {
    provisioned: true,
    platform: 'linux-x64',
    tts: { engine: 'piper', state: 'provisioned', binaryPath: '/x/piper', modelPath: '/x/voice.onnx' },
    stt: { engine: 'whisper-cpp', state: 'download-failed', reason: 'network timeout' },
    components: [{ id: 'piper-engine', state: 'installed', bytes: 100 }],
    configured: { set: [{ key: 'tts.provider', value: 'local' }], skipped: [{ key: 'voice.local.ttsBinary', reason: 'user-set' }] },
  };

  test('a full schema-shaped receipt parses verbatim', () => {
    const parsed = readVoiceLocalInstallResult(RECEIPT);
    expect(parsed).not.toBeNull();
    expect(parsed?.tts.state).toBe('provisioned');
    expect(parsed?.stt.state).toBe('download-failed');
    expect(parsed?.stt.reason).toBe('network timeout');
    expect(parsed?.configured.set[0]?.key).toBe('tts.provider');
    expect(parsed?.configured.skipped[0]?.reason).toBe('user-set');
  });

  test('a 200-with-empty-body answer parses to null (honest cannot-read)', () => {
    expect(readVoiceLocalInstallResult({})).toBeNull();
    expect(readVoiceLocalInstallResult(null)).toBeNull();
  });

  test('a receipt missing a per-engine terminal state parses to null — the receipt is meaningless without both', () => {
    expect(readVoiceLocalInstallResult({ ...RECEIPT, stt: { engine: 'whisper-cpp' } })).toBeNull();
    expect(readVoiceLocalInstallResult({ ...RECEIPT, tts: { engine: 'piper', state: 'half-done' } })).toBeNull();
  });
});

describe('voiceLocalInstallIsRetriable', () => {
  test('download-failed and checksum-mismatch are retriable', () => {
    expect(voiceLocalInstallIsRetriable('download-failed')).toBe(true);
    expect(voiceLocalInstallIsRetriable('checksum-mismatch')).toBe(true);
  });

  test('provisioned, unsupported-platform, bundle-unavailable, sideload-mismatch are not', () => {
    expect(voiceLocalInstallIsRetriable('provisioned')).toBe(false);
    expect(voiceLocalInstallIsRetriable('unsupported-platform')).toBe(false);
    expect(voiceLocalInstallIsRetriable('bundle-unavailable')).toBe(false);
    expect(voiceLocalInstallIsRetriable('sideload-mismatch')).toBe(false);
  });
});
