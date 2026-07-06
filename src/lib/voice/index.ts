/**
 * Voice surface public exports — TTS playback (request policy + Web Audio player),
 * mic capture for provider-backed speech-to-text, the shared voice config reads, and the
 * React glue. See each module for the honest-state and single-sink design notes.
 */
export * from './request-policy';
export * from './tts-player';
export * from './stt-recorder';
export * from './voice-config';
export * from './useVoice';
