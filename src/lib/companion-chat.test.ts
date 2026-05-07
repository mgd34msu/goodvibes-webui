import { describe, expect, test } from 'bun:test';
import {
  companionRouteFromModelOption,
  extractMessageId,
  extractSessionId,
  loadRecentCompanionSessionIds,
  prependRecentCompanionSessionId,
  removeRecentCompanionSessionIds,
} from './companion-chat';
import type { ModelOption } from './provider-models';

function modelOption(input: Partial<ModelOption>): ModelOption {
  return {
    id: 'openai:gpt-5.5',
    label: 'gpt-5.5',
    value: {},
    providerId: 'openai-subscriber',
    rawModelId: 'gpt-5.5',
    registryKey: 'openai:gpt-5.5',
    ...input,
  };
}

describe('companion chat helpers', () => {
  test('routes explicit chat sessions through the selected runtime provider row', () => {
    expect(companionRouteFromModelOption(modelOption({}))).toEqual({
      provider: 'openai-subscriber',
      model: 'gpt-5.5',
    });
  });

  test('does not infer a companion route from incomplete model options', () => {
    expect(companionRouteFromModelOption(undefined)).toBeNull();
    expect(companionRouteFromModelOption(modelOption({ providerId: '' }))).toBeNull();
    expect(companionRouteFromModelOption(modelOption({ rawModelId: '' }))).toBeNull();
  });

  test('extracts ids from companion chat SDK responses', () => {
    expect(extractSessionId({ sessionId: 'sess-1' })).toBe('sess-1');
    expect(extractSessionId({ session: { id: 'sess-2' } })).toBe('sess-2');
    expect(extractMessageId({ messageId: 'msg-1' })).toBe('msg-1');
    expect(extractMessageId({ message: { id: 'msg-2' } })).toBe('msg-2');
  });

  test('keeps a unique most-recent-first local session list', () => {
    expect(prependRecentCompanionSessionId(['a', 'b'], 'c')).toEqual(['c', 'a', 'b']);
    expect(prependRecentCompanionSessionId(['a', 'b'], 'b')).toEqual(['b', 'a']);
    expect(removeRecentCompanionSessionIds(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']);
  });

  test('loads only valid stored session ids', () => {
    const storage = { getItem: () => JSON.stringify(['sess-1', '', 123, 'sess-2']) };
    expect(loadRecentCompanionSessionIds(storage)).toEqual(['sess-1', 'sess-2']);
  });
});
