/**
 * VoiceSettings — the shared spoken-voice config surface.
 *
 * There is ONE voice config for the whole platform (the tts.provider / tts.voice keys the
 * TUI, agent, and daemon already share). This popover READS those keys (config.get) and
 * WRITES them (config.set), so choosing a voice here changes it everywhere — it never
 * invents a web-only voice. Availability and the provider list come straight from
 * voice.status, rendered with the shared presentation-contract tone/glyph so the state
 * reads the same as it does on every other surface.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Settings2, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invokeMethod, sdk } from '../../lib/goodvibes';
import { asRecord } from '../../lib/object';
import { classifyBadgeTone, contractGlyphForBadgeTone } from '../../lib/presentation-bridge';
import { useSharedVoiceConfig, useVoiceStatus } from '../../lib/voice/useVoice';
import { TTS_UNAVAILABLE_MESSAGE, describeSharedVoice } from '../../lib/voice/voice-config';

interface VoiceOption {
  id: string;
  label: string;
}

function readVoices(data: unknown): VoiceOption[] {
  const list = asRecord(data).voices;
  if (!Array.isArray(list)) return [];
  return list.map((entry) => {
    const v = asRecord(entry);
    const id = typeof v.id === 'string' ? v.id : '';
    const label = typeof v.label === 'string' ? v.label : id;
    return { id, label };
  }).filter((v) => v.id);
}

export function VoiceSettings() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { availability } = useVoiceStatus();
  const { config } = useSharedVoiceConfig();

  const ttsProviders = useMemo(
    () => availability.providers.filter((p) => p.capabilities.includes('tts') || p.capabilities.includes('tts-stream')),
    [availability.providers],
  );
  // Empty string means "unset" here, so fall through to the derived default (?? only
  // catches null/undefined, which is why an explicit non-empty check leads).
  const selectedProvider = config.provider !== ''
    ? config.provider
    : (availability.defaultTtsProviderId ?? ttsProviders[0]?.id ?? '');

  const voicesQuery = useQuery({
    queryKey: ['voice', 'voices', selectedProvider],
    queryFn: () => sdk.operator.voice.voices(selectedProvider || undefined),
    enabled: open && availability.ttsAvailable,
    staleTime: 60_000,
  });
  const voices = useMemo(() => readVoices(voicesQuery.data), [voicesQuery.data]);

  const setKey = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => invokeMethod('config.set', { key, value }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['voice', 'config'] });
    },
  });

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const tone = classifyBadgeTone(availability.ttsAvailable ? 'ready' : 'unconfigured');
  const glyph = contractGlyphForBadgeTone(tone);

  return (
    <div className="voice-settings" ref={containerRef}>
      <button
        type="button"
        className="composer-tool voice-settings-btn"
        title="Voice settings"
        aria-label="Voice settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Settings2 size={16} aria-hidden />
      </button>

      {open && (
        <div className="voice-settings-popover" role="dialog" aria-label="Voice settings">
          <div className="voice-settings-header">
            <span className={`voice-settings-tone tone-${tone}`} aria-hidden>{glyph}</span>
            <span className="voice-settings-title">Spoken voice</span>
            {/* On a phone this popover becomes a full-screen sheet (voice.css, matching
                the shared Modal's <=480px convention) with no "tap outside" area to close
                it, so an explicit close button is required, not optional chrome. */}
            <button
              type="button"
              className="voice-settings-close"
              aria-label="Close voice settings"
              onClick={() => setOpen(false)}
            >
              <X size={16} aria-hidden />
            </button>
          </div>

          {availability.ttsAvailable ? (
            <>
              <p className="voice-settings-shared">
                Current voice: <strong>{describeSharedVoice(config)}</strong>
              </p>
              <label className="voice-settings-field">
                <span>Provider</span>
                <select
                  value={selectedProvider}
                  disabled={setKey.isPending}
                  onChange={(event) => setKey.mutate({ key: 'tts.provider', value: event.target.value })}
                >
                  {ttsProviders.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </label>
              <label className="voice-settings-field">
                <span>Voice</span>
                <select
                  value={config.voice}
                  disabled={setKey.isPending || voicesQuery.isLoading || !voices.length}
                  onChange={(event) => setKey.mutate({ key: 'tts.voice', value: event.target.value })}
                >
                  <option value="">Provider default</option>
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </select>
              </label>
              {voicesQuery.isLoading && <p className="voice-settings-hint">Loading voices…</p>}
              <p className="voice-settings-hint">One voice across terminal, desktop, and agent.</p>
            </>
          ) : (
            <p className="voice-settings-unavailable">{TTS_UNAVAILABLE_MESSAGE}</p>
          )}
        </div>
      )}
    </div>
  );
}
