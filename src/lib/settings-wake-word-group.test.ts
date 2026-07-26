/**
 * Wake-word settings reach the web settings view under the Voice group.
 *
 * `voice.wake.*` shares the `voice` namespace with the local STT/TTS engine
 * paths, so it groups with them — the platform's category rule is "one group
 * per top-level namespace", and wake-word detection gets its own titled block
 * inside that group from the SDK's FEATURE_SETTINGS surface rather than from a
 * second, sub-namespace category. This pins the label and the grouping so a
 * future change to either is deliberate.
 */
import { describe, expect, test } from 'bun:test';
import { categoryLabelForKey, CATEGORY_LABELS } from './config-redaction';
import { groupLabelForNamespace } from './settings-model';

describe('the voice settings group', () => {
  test('wake-word and local-engine keys share one group', () => {
    expect(categoryLabelForKey('voice.wake.enabled')).toBe('Voice');
    expect(categoryLabelForKey('voice.wake.threshold')).toBe('Voice');
    expect(categoryLabelForKey('voice.wake.surfaces.webui')).toBe('Voice');
    expect(categoryLabelForKey('voice.local.sttEngine')).toBe('Voice');
  });

  test('the group has a real label rather than a Title Case fallback', () => {
    expect(CATEGORY_LABELS.voice).toBe('Voice');
    expect(groupLabelForNamespace('voice')).toBe('Voice');
  });

  test('an unmapped namespace still falls back to Title Case, never a fabricated label', () => {
    expect(categoryLabelForKey('someNewDomain.key')).toBe('Some New Domain');
    expect(groupLabelForNamespace('someNewDomain')).toBe('Some New Domain');
  });
});
