import { describe, expect, test } from 'bun:test';
import { isCardMaterialKey } from './card-material';

describe('isCardMaterialKey', () => {
  test('matches bare cvv / pan keys', () => {
    expect(isCardMaterialKey('payments.cards.visa.cvv')).toBe(true);
    expect(isCardMaterialKey('payments.cards.visa.cvv2')).toBe(true);
    expect(isCardMaterialKey('payments.cards.visa.cvc')).toBe(true);
    expect(isCardMaterialKey('pan')).toBe(true);
    expect(isCardMaterialKey('payments.cards.visa.pan')).toBe(true);
  });

  test('matches compound cardNumber forms', () => {
    expect(isCardMaterialKey('payments.cards.visa.cardNumber')).toBe(true);
    expect(isCardMaterialKey('payments.cards.visa.cardnumber')).toBe(true);
    expect(isCardMaterialKey('payments.cards.visa.card_number')).toBe(true);
    expect(isCardMaterialKey('cardNum')).toBe(true);
  });

  test('matches a compound key ending in "pan" — the trailing word identifies the material', () => {
    expect(isCardMaterialKey('payments.cards.visa.rawPan')).toBe(true);
    expect(isCardMaterialKey('payments.cards.visa.visaPan')).toBe(true);
  });

  test('does NOT match legitimate keys that merely contain "pan" as a substring', () => {
    expect(isCardMaterialKey('surfaces.slack.companyName')).toBe(false);
    expect(isCardMaterialKey('device.location.japanRegion')).toBe(false);
  });

  test('does NOT match a compound key where "pan"/"cvv" is the LEADING word of a real setting name', () => {
    // payments.cvvHandling is a real, non-secret policy setting ('stored' | 'prompt') —
    // "cvv" here qualifies "Handling", it is not the trailing identifying word.
    expect(isCardMaterialKey('payments.cvvHandling')).toBe(false);
    // Same shape hypothetically for a map "pan" (as in pan/zoom) feature flag.
    expect(isCardMaterialKey('knowledge.map.panEnabled')).toBe(false);
  });

  test('does NOT match payments.defaultCardId — a card reference, not card material', () => {
    expect(isCardMaterialKey('payments.defaultCardId')).toBe(false);
  });

  test('does NOT match ordinary payments schema keys', () => {
    expect(isCardMaterialKey('payments.enabled')).toBe(false);
    expect(isCardMaterialKey('payments.currency')).toBe(false);
    expect(isCardMaterialKey('payments.cvvHandling')).toBe(false);
    expect(isCardMaterialKey('payments.budget.dailyItemCents')).toBe(false);
    expect(isCardMaterialKey('payments.windows.vetoMinutes')).toBe(false);
    expect(isCardMaterialKey('payments.notifyChannels')).toBe(false);
  });

  test('is case-insensitive', () => {
    expect(isCardMaterialKey('payments.cards.visa.CVV')).toBe(true);
    expect(isCardMaterialKey('payments.cards.visa.PAN')).toBe(true);
    expect(isCardMaterialKey('payments.cards.visa.CardNumber')).toBe(true);
  });
});
