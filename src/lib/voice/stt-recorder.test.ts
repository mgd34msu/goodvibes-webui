import { describe, expect, test } from 'bun:test';
import {
  MicCaptureError,
  detectMicSupport,
  formatFromMimeType,
  startRecording,
} from './stt-recorder';

// A minimal MediaRecorder double that emits one data chunk then fires onstop.
class FakeRecorder {
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  static isTypeSupported(type: string): boolean {
    return type === 'audio/webm' || type === 'audio/webm;codecs=opus';
  }
  start(): void {
    setTimeout(() => this.ondataavailable?.({ data: new Blob(['abc'], { type: 'audio/webm' }) }), 0);
  }
  stop(): void {
    setTimeout(() => this.onstop?.(), 0);
  }
}

function fakeEnv(over: Record<string, unknown> = {}) {
  const track = { stop: () => undefined };
  return {
    isSecureContext: true,
    mediaDevices: { getUserMedia: () => Promise.resolve({ getTracks: () => [track] }) },
    MediaRecorder: FakeRecorder,
    ...over,
  };
}

describe('detectMicSupport', () => {
  test('a secure context with mic APIs is ok', () => {
    expect(detectMicSupport(fakeEnv())).toBe('ok');
  });

  test('an insecure context (plain-HTTP LAN) reports insecure-context', () => {
    expect(detectMicSupport(fakeEnv({ isSecureContext: false }))).toBe('insecure-context');
  });

  test('missing mic APIs over insecure http still points at the secure-context fix', () => {
    expect(detectMicSupport(fakeEnv({ isSecureContext: false, MediaRecorder: undefined }))).toBe('insecure-context');
  });

  test('a secure context without MediaRecorder is unsupported', () => {
    expect(detectMicSupport(fakeEnv({ MediaRecorder: undefined }))).toBe('unsupported');
  });
});

describe('formatFromMimeType', () => {
  test('derives the voice.stt format token from the MIME type', () => {
    expect(formatFromMimeType('audio/webm;codecs=opus')).toBe('webm');
    expect(formatFromMimeType('audio/mpeg')).toBe('mp3');
    expect(formatFromMimeType('audio/wav')).toBe('wav');
    expect(formatFromMimeType('audio/ogg')).toBe('ogg');
  });
});

describe('startRecording — honest failure reasons', () => {
  test('refuses an insecure context with reason insecure-context', async () => {
    await expect(startRecording(fakeEnv({ isSecureContext: false }))).rejects.toMatchObject({
      reason: 'insecure-context',
    });
  });

  test('refuses an unsupported browser with reason unsupported', async () => {
    await expect(startRecording(fakeEnv({ MediaRecorder: undefined }))).rejects.toMatchObject({
      reason: 'unsupported',
    });
  });

  test('maps a blocked-permission getUserMedia into reason permission-denied', async () => {
    const env = fakeEnv({
      mediaDevices: {
        getUserMedia: () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })),
      },
    });
    const error = await startRecording(env).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MicCaptureError);
    expect((error as MicCaptureError).reason).toBe('permission-denied');
  });

  test('captures audio and returns a base64 clip with a derived format', async () => {
    const handle = await startRecording(fakeEnv());
    const clip = await handle.stop();
    expect(clip.mimeType).toBe('audio/webm');
    expect(clip.format).toBe('webm');
    expect(clip.dataBase64.length).toBeGreaterThan(0);
  });
});
