/**
 * stt-recorder.ts — microphone capture for provider-backed speech-to-text.
 *
 * Captures the microphone with getUserMedia + MediaRecorder and hands back the recorded
 * audio as bytes for the daemon's voice.stt route to transcribe. It DELIBERATELY does NOT
 * use the browser's built-in SpeechRecognition — transcription must go through the same
 * registered voice provider every surface uses, so the words come back the same way they
 * would in the TUI or agent, not from a different on-device engine.
 *
 * Every failure is an honest, named state, never a dead button:
 *   - 'insecure-context'  the page is plain HTTP (a LAN IP without TLS) so the browser
 *                         refuses microphone access — surface an honest pointer to open
 *                         it over HTTPS (e.g. Tailscale serve), not a broken control.
 *   - 'unsupported'       the browser has no getUserMedia/MediaRecorder at all.
 *   - 'permission-denied' the user (or policy) blocked the microphone.
 *   - 'capture-failed'    anything else went wrong capturing audio.
 */

export type MicSupport = 'ok' | 'insecure-context' | 'unsupported';

export type MicFailureReason = 'permission-denied' | 'capture-failed' | 'insecure-context' | 'unsupported';

export class MicCaptureError extends Error {
  readonly reason: MicFailureReason;
  constructor(reason: MicFailureReason, message: string) {
    super(message);
    this.name = 'MicCaptureError';
    this.reason = reason;
  }
}

interface MinimalMediaDevices {
  getUserMedia(constraints: { audio: boolean }): Promise<MinimalMediaStream>;
}
interface MinimalMediaStream {
  getTracks(): { stop(): void }[];
}
interface MinimalMediaRecorder {
  start(): void;
  stop(): void;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
  readonly mimeType: string;
}
interface MediaRecorderCtor {
  new (stream: MinimalMediaStream, options?: { mimeType?: string }): MinimalMediaRecorder;
  isTypeSupported?: (type: string) => boolean;
}

interface MicEnv {
  readonly isSecureContext: boolean;
  readonly mediaDevices: MinimalMediaDevices | undefined;
  readonly MediaRecorder: MediaRecorderCtor | undefined;
}

function browserEnv(): MicEnv {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return { isSecureContext: false, mediaDevices: undefined, MediaRecorder: undefined };
  }
  const w = window as unknown as { isSecureContext?: boolean; MediaRecorder?: MediaRecorderCtor };
  const nav = navigator as unknown as { mediaDevices?: MinimalMediaDevices };
  return {
    // localhost is treated as a secure context by browsers even over http.
    isSecureContext: w.isSecureContext === true,
    mediaDevices: nav.mediaDevices,
    MediaRecorder: w.MediaRecorder,
  };
}

/** Classify whether the mic can be used here, before any capture is attempted. */
export function detectMicSupport(env: MicEnv = browserEnv()): MicSupport {
  if (!env.MediaRecorder || !env.mediaDevices || typeof env.mediaDevices.getUserMedia !== 'function') {
    // A page served over plain HTTP to a non-localhost host has mediaDevices undefined —
    // report that as the insecure-context state (the actionable one) rather than a bare
    // 'unsupported', so the pointer tells the user how to fix it.
    if (!env.isSecureContext) return 'insecure-context';
    return 'unsupported';
  }
  if (!env.isSecureContext) return 'insecure-context';
  return 'ok';
}

/** The recorded clip, ready for voice.stt (dataBase64 + a mimeType/format pair). */
export interface RecordedAudio {
  readonly blob: Blob;
  readonly mimeType: string;
  readonly format: string;
  readonly dataBase64: string;
}

export interface RecordingHandle {
  /** Stop capturing and resolve the recorded clip. */
  stop(): Promise<RecordedAudio>;
  /** Abandon the recording without transcribing (release the mic). */
  cancel(): void;
}

const PREFERRED_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];

function pickMimeType(Ctor: MediaRecorderCtor): string | undefined {
  if (typeof Ctor.isTypeSupported !== 'function') return undefined;
  return PREFERRED_MIME_TYPES.find((type) => Ctor.isTypeSupported?.(type));
}

/** Derive the voice.stt `format` token from a MIME type (e.g. audio/webm -> "webm"). */
export function formatFromMimeType(mimeType: string): string {
  const base = mimeType.split(';')[0]?.trim() ?? '';
  const subtype = base.split('/')[1] ?? base;
  if (subtype === 'mpeg') return 'mp3';
  if (subtype === 'x-wav' || subtype === 'wave') return 'wav';
  return subtype || 'webm';
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  // btoa exists in browsers and in bun/happy-dom; guard for any env that lacks it.
  if (typeof btoa === 'function') return btoa(binary);
  const maybeBuffer = (globalThis as {
    Buffer?: { from(data: Uint8Array): { toString(encoding: string): string } };
  }).Buffer;
  return maybeBuffer ? maybeBuffer.from(bytes).toString('base64') : binary;
}

/**
 * startRecording — request the mic and begin capturing. Rejects with a MicCaptureError
 * carrying an honest `reason` when the environment refuses (insecure context, unsupported)
 * or the user denies permission. On success returns a handle whose stop() yields the clip.
 */
export async function startRecording(env: MicEnv = browserEnv()): Promise<RecordingHandle> {
  const support = detectMicSupport(env);
  if (support === 'insecure-context') {
    throw new MicCaptureError('insecure-context', 'The microphone needs a secure (HTTPS) connection.');
  }
  if (support === 'unsupported' || !env.mediaDevices || !env.MediaRecorder) {
    throw new MicCaptureError('unsupported', 'This browser cannot capture the microphone.');
  }

  let stream: MinimalMediaStream;
  try {
    stream = await env.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
      throw new MicCaptureError('permission-denied', 'Microphone access was blocked.');
    }
    throw new MicCaptureError('capture-failed', 'Could not start recording from the microphone.');
  }

  const mimeType = pickMimeType(env.MediaRecorder);
  const recorder = new env.MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };

  const releaseMic = () => {
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    }
  };

  recorder.start();

  return {
    stop: () =>
      new Promise<RecordedAudio>((resolve, reject) => {
        recorder.onerror = () => {
          releaseMic();
          reject(new MicCaptureError('capture-failed', 'Recording failed.'));
        };
        recorder.onstop = () => {
          releaseMic();
          // recorder.mimeType can be '' before data flows — fall through to the picked
          // type, then a safe default (?? only catches null/undefined).
          const type = recorder.mimeType.trim() ? recorder.mimeType : (mimeType ?? 'audio/webm');
          const blob = new Blob(chunks, { type });
          blob
            .arrayBuffer()
            .then((buffer) => {
              resolve({
                blob,
                mimeType: type,
                format: formatFromMimeType(type),
                dataBase64: arrayBufferToBase64(buffer),
              });
            })
            .catch(() => reject(new MicCaptureError('capture-failed', 'Could not read the recorded audio.')));
        };
        recorder.stop();
      }),
    cancel: () => {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      try {
        recorder.stop();
      } catch {
        /* ignore */
      }
      releaseMic();
    },
  };
}
