/**
 * useVoice.ts — React glue for the voice surface.
 *
 *   useVoiceStatus()      the honest availability posture (voice.status), cached/shared.
 *   useSharedVoiceConfig() the shared tts.provider/tts.voice defaults (config.get).
 *   useTts()              speak/stop a reply through the singleton engine, with live state.
 *   useVoiceInput()       mic capture -> voice.stt -> transcript, as an honest state machine.
 */

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sdk } from '../goodvibes';
import { asRecord } from '../object';
import { coalesceForSpeech } from './request-policy';
import { ttsEngine, canPlayAudio, type TtsPlaybackState } from './tts-player';
import {
  deriveVoiceAvailability,
  readSharedVoiceConfig,
  type SharedVoiceConfig,
  type VoiceAvailability,
} from './voice-config';
import {
  detectMicSupport,
  startRecording,
  MicCaptureError,
  type MicSupport,
  type MicFailureReason,
  type RecordingHandle,
} from './stt-recorder';

/** The container format requested from the streaming TTS route. mp3 decodes across
 * browsers' AudioContext.decodeAudioData; providers default to it too. */
const DEFAULT_TTS_FORMAT = 'mp3';

const EMPTY_CONFIG: SharedVoiceConfig = { provider: '', voice: '' };

/** voice.status -> availability posture. Failure degrades to "not available" honestly. */
export function useVoiceStatus(): { availability: VoiceAvailability; isLoading: boolean } {
  const query = useQuery({
    queryKey: ['voice', 'status'],
    queryFn: () => sdk.operator.voice.status(),
    staleTime: 30_000,
  });
  const availability = useMemo(() => deriveVoiceAvailability(query.data), [query.data]);
  return { availability, isLoading: query.isLoading };
}

/** config.get -> the shared tts.* voice defaults. Failure degrades to empty (the daemon
 * then applies its own defaults). */
export function useSharedVoiceConfig(): { config: SharedVoiceConfig; isLoading: boolean } {
  const query = useQuery({
    queryKey: ['voice', 'config'],
    queryFn: () => sdk.operator.config.get(),
    staleTime: 30_000,
    retry: false,
  });
  const config = useMemo(
    () => (query.data ? readSharedVoiceConfig(query.data) : EMPTY_CONFIG),
    [query.data],
  );
  return { config, isLoading: query.isLoading };
}

export interface UseTtsResult {
  readonly availability: VoiceAvailability;
  readonly voiceConfig: SharedVoiceConfig;
  readonly state: TtsPlaybackState;
  readonly canPlay: boolean;
  /** True while THIS message is loading or playing. */
  readonly isActive: (id: string) => boolean;
  readonly speak: (id: string, text: string) => void;
  readonly stop: () => void;
}

export function useTts(): UseTtsResult {
  const { availability } = useVoiceStatus();
  const { config } = useSharedVoiceConfig();

  const state = useSyncExternalStore(
    useCallback((onChange: () => void) => ttsEngine.subscribe(onChange), []),
    () => ttsEngine.getState(),
    () => ttsEngine.getState(),
  );

  // Synthesise one segment via the streaming TTS route, requesting the SHARED voice so it
  // sounds the same as the TUI/agent. Omitted provider/voice let the daemon apply the
  // shared tts.* defaults itself.
  const synth = useCallback(
    (text: string, signal: AbortSignal) =>
      sdk.operator.voice
        .ttsStream(
          {
            text,
            format: DEFAULT_TTS_FORMAT,
            ...(config.provider ? { providerId: config.provider } : {}),
            ...(config.voice ? { voiceId: config.voice } : {}),
            ...(config.speed ? { speed: config.speed } : {}),
          },
          signal,
        )
        .then((response) => response.arrayBuffer()),
    [config.provider, config.voice, config.speed],
  );

  const speak = useCallback(
    (id: string, text: string) => {
      const segments = coalesceForSpeech(text);
      void ttsEngine.speak({ id, segments, synth });
    },
    [synth],
  );

  const stop = useCallback(() => ttsEngine.stop(), []);
  const isActive = useCallback((id: string) => state.id === id, [state.id]);

  return { availability, voiceConfig: config, state, canPlay: canPlayAudio(), isActive, speak, stop };
}

export type MicPhase = 'idle' | 'requesting' | 'recording' | 'transcribing' | 'error';

export interface MicError {
  readonly reason: MicFailureReason | 'stt-failed';
  readonly message: string;
}

export interface UseVoiceInputResult {
  readonly support: MicSupport;
  readonly availability: VoiceAvailability;
  readonly phase: MicPhase;
  readonly error: MicError | null;
  /** True when dictation can actually be attempted (secure context + STT provider). */
  readonly ready: boolean;
  readonly start: () => Promise<void>;
  readonly stopAndTranscribe: () => Promise<void>;
  readonly cancel: () => void;
}

/** Mic capture -> voice.stt -> transcript. The transcript is handed to `onTranscript` for
 * REVIEW-BEFORE-SEND (it fills the composer draft; it is never auto-sent). */
export function useVoiceInput(onTranscript: (text: string) => void): UseVoiceInputResult {
  const { availability } = useVoiceStatus();
  const support = useMemo(() => detectMicSupport(), []);
  const [phase, setPhase] = useState<MicPhase>('idle');
  const [error, setError] = useState<MicError | null>(null);
  const handleRef = useRef<RecordingHandle | null>(null);

  const ready = support === 'ok' && availability.sttAvailable;

  const start = useCallback(async () => {
    setError(null);
    setPhase('requesting');
    try {
      handleRef.current = await startRecording();
      setPhase('recording');
    } catch (e) {
      handleRef.current = null;
      const reason = e instanceof MicCaptureError ? e.reason : 'capture-failed';
      const message = e instanceof Error ? e.message : 'Could not start recording.';
      setError({ reason, message });
      setPhase('error');
    }
  }, []);

  const stopAndTranscribe = useCallback(async () => {
    const handle = handleRef.current;
    if (!handle) return;
    handleRef.current = null;
    setPhase('transcribing');
    try {
      const audio = await handle.stop();
      const result = await sdk.operator.voice.stt({
        audio: { mimeType: audio.mimeType, format: audio.format, dataBase64: audio.dataBase64, metadata: {} },
        ...(availability.defaultSttProviderId ? { providerId: availability.defaultSttProviderId } : {}),
      });
      const text = asRecord(result).text;
      onTranscript(typeof text === 'string' ? text.trim() : '');
      setPhase('idle');
    } catch (e) {
      const reason = e instanceof MicCaptureError ? e.reason : 'stt-failed';
      const message = e instanceof Error ? e.message : 'Could not transcribe the recording.';
      setError({ reason, message });
      setPhase('error');
    }
  }, [availability.defaultSttProviderId, onTranscript]);

  const cancel = useCallback(() => {
    handleRef.current?.cancel();
    handleRef.current = null;
    setPhase('idle');
    setError(null);
  }, []);

  return { support, availability, phase, error, ready, start, stopAndTranscribe, cancel };
}
