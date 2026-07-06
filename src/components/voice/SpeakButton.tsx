/**
 * SpeakButton — read an assistant reply aloud through the streaming TTS route.
 *
 * Honest states, no dead controls:
 *   - no configured voice provider  -> disabled, with the bring-your-own-key refusal.
 *   - browser can't play audio      -> disabled, with an honest reason.
 *   - ready & idle                  -> a speaker; click to speak (uses the SHARED voice).
 *   - this reply loading            -> a spinner; click cancels.
 *   - this reply playing            -> a stop square; click interrupts INSTANTLY.
 *
 * At most one reply is ever heard: the engine interrupts any prior playback when a new
 * Speak is clicked.
 */
import { Loader, Square, Volume2, VolumeX } from 'lucide-react';
import { useTts } from '../../lib/voice/useVoice';
import { TTS_UNAVAILABLE_MESSAGE, describeSharedVoice } from '../../lib/voice/voice-config';

interface SpeakButtonProps {
  readonly messageId: string;
  readonly text: string;
}

export function SpeakButton({ messageId, text }: SpeakButtonProps) {
  const { availability, voiceConfig, canPlay, state, isActive, speak, stop } = useTts();

  if (!text.trim()) return null;

  const active = isActive(messageId);
  const loading = active && state.phase === 'loading';
  const playing = active && state.phase === 'playing';

  if (!availability.ttsAvailable || !canPlay) {
    const reason = !canPlay
      ? 'This browser cannot play synthesised audio.'
      : TTS_UNAVAILABLE_MESSAGE;
    return (
      <button
        type="button"
        className="voice-speak-btn voice-unavailable"
        title={reason}
        aria-label={`Read aloud unavailable — ${reason}`}
        disabled
      >
        <VolumeX size={13} aria-hidden />
      </button>
    );
  }

  if (loading) {
    return (
      <button
        type="button"
        className="voice-speak-btn is-loading"
        title="Preparing spoken reply — click to cancel"
        aria-label="Preparing spoken reply — click to cancel"
        onClick={stop}
      >
        <Loader size={13} aria-hidden className="voice-spin" />
      </button>
    );
  }

  if (playing) {
    return (
      <button
        type="button"
        className="voice-speak-btn is-playing"
        title="Stop reading"
        aria-label="Stop reading aloud"
        onClick={stop}
      >
        <Square size={13} aria-hidden />
      </button>
    );
  }

  return (
    <button
      type="button"
      className="voice-speak-btn"
      title={`Read aloud (voice: ${describeSharedVoice(voiceConfig)})`}
      aria-label="Read this reply aloud"
      onClick={() => speak(messageId, text)}
    >
      <Volume2 size={13} aria-hidden />
    </button>
  );
}
