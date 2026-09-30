/**
 * The new-chat screen's words: the time-of-day greeting, the name it greets
 * (never a placeholder like "Operator"), and the four starting points.
 */
import { describe, expect, test } from 'bun:test';
import { CHAT_SUGGESTIONS, greeting, greetingName, greetingPhrase } from './new-chat';

describe('greetingPhrase', () => {
  test('morning from 5 to noon, afternoon to 6 pm, evening otherwise', () => {
    expect(greetingPhrase(5)).toBe('Good morning');
    expect(greetingPhrase(11)).toBe('Good morning');
    expect(greetingPhrase(12)).toBe('Good afternoon');
    expect(greetingPhrase(17)).toBe('Good afternoon');
    expect(greetingPhrase(18)).toBe('Good evening');
    expect(greetingPhrase(23)).toBe('Good evening');
    expect(greetingPhrase(2)).toBe('Good evening');
  });
});

describe('greetingName and greeting', () => {
  test('a display name is used as given; an email shows its local part', () => {
    expect(greetingName('Mike')).toBe('Mike');
    expect(greetingName('mike@goodvibes.local')).toBe('mike');
    expect(greeting(20, greetingName('Mike'))).toBe('Good evening, Mike');
  });

  test('no name greets without one', () => {
    expect(greetingName('')).toBe('');
    expect(greetingName(undefined)).toBe('');
    expect(greeting(9, '')).toBe('Good morning');
  });
});

describe('CHAT_SUGGESTIONS', () => {
  test('four starting points tied to real capabilities, each filling the composer', () => {
    expect(CHAT_SUGGESTIONS.map((s) => s.id)).toEqual(['calendar', 'mail', 'running', 'memory']);
    for (const suggestion of CHAT_SUGGESTIONS) {
      expect(suggestion.label.length).toBeGreaterThan(0);
      expect(suggestion.prompt.length).toBeGreaterThan(0);
    }
  });
});
