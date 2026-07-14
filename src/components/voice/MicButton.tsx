/**
 * MicButton — dictate a message: capture the mic, transcribe it through the daemon's
 * voice.stt route (the SAME provider every surface uses — not the browser's built-in
 * speech engine), and drop the transcript into the composer for REVIEW BEFORE SENDING.
 *
 * This is the headline voice affordance on mobile, so every unavailable case is an honest,
 * visible pointer rather than a dead button:
 *   - plain-HTTP LAN (insecure context) -> "open over HTTPS to dictate" pointer.
 *   - browser can't capture audio        -> honest unsupported note.
 *   - no STT provider configured         -> bring-your-own-key refusal.
 *   - permission blocked                 -> "allow it and try again".
 */
import { Loader, Mic, MicOff, Square } from 'lucide-react';
import { useVoiceInput } from '../../lib/voice/useVoice';
import { STT_UNAVAILABLE_MESSAGE } from '../../lib/voice/voice-config';
import { capabilityReason, useOriginPosture } from '../../hooks/useOriginPosture';

interface MicButtonProps {
  /** Receives the transcript. The composer fills its draft with it — never auto-sends. */
  readonly onTranscript: (text: string) => void;
  /** Disable while a send is in flight (matches the other composer tools). */
  readonly disabled?: boolean;
}

// The honest fallback while pairing.posture.get hasn't answered yet (or errored) — still
// true, just less specific than the daemon's own wording about ITS deployment.
const SECURE_CONTEXT_FALLBACK_NOTE =
  'Microphone needs a secure (HTTPS) connection — open this page over HTTPS (for example via Tailscale) to dictate.';

export function MicButton({ onTranscript, disabled }: MicButtonProps) {
  const { support, availability, phase, error, start, stopAndTranscribe } = useVoiceInput(onTranscript);
  // pairing.posture.get is the daemon's own labeled-degradation reason for this exact
  // origin ("needs https — available via tailscale") — never a client-fabricated guess.
  // The fallback above covers the brief window before it answers.
  const { posture } = useOriginPosture();
  const SECURE_CONTEXT_NOTE = capabilityReason(posture, 'microphone') ?? SECURE_CONTEXT_FALLBACK_NOTE;

  // Resolve a single (icon, label, note, onClick, disabled) tuple for the current state.
  let icon = <Mic size={16} aria-hidden />;
  let label = 'Dictate a message';
  let note = '';
  let onClick: (() => void) | undefined;
  let controlDisabled = Boolean(disabled);
  let recording = false;

  if (support === 'insecure-context') {
    icon = <MicOff size={16} aria-hidden />;
    label = 'Dictation unavailable — needs HTTPS';
    note = SECURE_CONTEXT_NOTE;
    controlDisabled = true;
  } else if (support === 'unsupported') {
    icon = <MicOff size={16} aria-hidden />;
    label = 'Dictation unavailable — not supported in this browser';
    note = 'This browser cannot capture the microphone.';
    controlDisabled = true;
  } else if (!availability.sttAvailable) {
    icon = <MicOff size={16} aria-hidden />;
    label = 'Dictation unavailable — no speech-to-text provider';
    note = STT_UNAVAILABLE_MESSAGE;
    controlDisabled = true;
  } else if (phase === 'recording') {
    icon = <Square size={16} aria-hidden />;
    label = 'Stop and transcribe';
    note = 'Recording — tap to stop and transcribe.';
    onClick = () => void stopAndTranscribe();
    recording = true;
  } else if (phase === 'requesting') {
    icon = <Loader size={16} aria-hidden className="voice-spin" />;
    label = 'Requesting microphone…';
    note = 'Requesting the microphone…';
    controlDisabled = true;
  } else if (phase === 'transcribing') {
    icon = <Loader size={16} aria-hidden className="voice-spin" />;
    label = 'Transcribing…';
    note = 'Transcribing your message…';
    controlDisabled = true;
  } else if (phase === 'error') {
    label = 'Dictation failed — tap to try again';
    note = error?.reason === 'permission-denied'
      ? 'Microphone access was blocked. Allow it in your browser settings, then tap the mic to try again.'
      : `${error?.message ?? 'Dictation failed.'} Tap the mic to try again.`;
    onClick = () => void start();
  } else {
    onClick = () => void start();
  }

  return (
    <span className="voice-mic">
      {note && (
        <span className="voice-mic-note" role="status" aria-live="polite">
          {note}
        </span>
      )}
      <button
        type="button"
        className={`composer-tool voice-mic-btn${recording ? ' is-recording' : ''}`}
        title={note || label}
        aria-label={label}
        aria-pressed={recording}
        disabled={controlDisabled}
        onClick={onClick}
      >
        {icon}
      </button>
    </span>
  );
}
