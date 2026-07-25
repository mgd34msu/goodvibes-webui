/**
 * Unit tests for the tool-activity helpers in message-utils.ts:
 * toolFriendlyLabel, summarizeToolActivity, toolKeyArg, toolResultText.
 *
 * These back the folded tool-call rendering (ToolActivityGroup) — the platform-
 * wide "keep tool results, fold them" fix applied to the webui.
 */
import { describe, expect, test } from 'bun:test';
import {
  toolFriendlyLabel,
  summarizeToolActivity,
  toolKeyArg,
  toolResultText,
} from './message-utils';

describe('toolFriendlyLabel', () => {
  test('maps known tool names (case-insensitive) to their short label', () => {
    expect(toolFriendlyLabel('Read')).toBe('read');
    expect(toolFriendlyLabel('bash')).toBe('exec');
    expect(toolFriendlyLabel('BASH')).toBe('exec');
    expect(toolFriendlyLabel('Grep')).toBe('search');
    expect(toolFriendlyLabel('Glob')).toBe('search');
    expect(toolFriendlyLabel('WebSearch')).toBe('web search');
  });

  test('falls back to the raw tool name for an unrecognized tool', () => {
    expect(toolFriendlyLabel('CustomMcpTool')).toBe('CustomMcpTool');
  });

  test('falls back to "tool" for an empty/whitespace name', () => {
    expect(toolFriendlyLabel('')).toBe('tool');
    expect(toolFriendlyLabel('   ')).toBe('tool');
  });
});

describe('summarizeToolActivity', () => {
  test('a single call summarizes with no count suffix', () => {
    expect(summarizeToolActivity([{ toolName: 'bash' }])).toBe('exec');
  });

  test('repeated tools get a real ×N count, never invented', () => {
    expect(summarizeToolActivity([
      { toolName: 'read' }, { toolName: 'read' }, { toolName: 'bash' },
    ])).toBe('read×2, exec');
  });

  test('an empty list summarizes to an empty string', () => {
    expect(summarizeToolActivity([])).toBe('');
  });

  test('groups by friendly label, not raw tool name (bash and exec collapse together)', () => {
    expect(summarizeToolActivity([{ toolName: 'bash' }, { toolName: 'exec' }])).toBe('exec×2');
  });
});

describe('toolKeyArg', () => {
  test('extracts file_path when present', () => {
    expect(toolKeyArg({ file_path: '/tmp/foo.ts' })).toBe('/tmp/foo.ts');
  });

  test('extracts command when file_path is absent', () => {
    expect(toolKeyArg({ command: 'ls -la' })).toBe('ls -la');
  });

  test('checks fields in priority order (file_path before command)', () => {
    expect(toolKeyArg({ file_path: '/a.ts', command: 'ls' })).toBe('/a.ts');
  });

  test('returns empty string when no known field is present', () => {
    expect(toolKeyArg({ unrelatedField: 123 })).toBe('');
  });

  test('returns empty string for non-object input', () => {
    expect(toolKeyArg('just a string')).toBe('');
    expect(toolKeyArg(undefined)).toBe('');
    expect(toolKeyArg(null)).toBe('');
  });

  test('ignores a blank string value and keeps looking', () => {
    expect(toolKeyArg({ file_path: '   ', command: 'ls' })).toBe('ls');
  });
});

describe('toolResultText', () => {
  test('a string result passes through unchanged', () => {
    expect(toolResultText('plain text result')).toBe('plain text result');
  });

  test('an object result renders as compact JSON', () => {
    const text = toolResultText({ ok: true, count: 3 });
    expect(text).toContain('"ok": true');
    expect(text).toContain('"count": 3');
  });

  test('undefined/null render as empty string, never "undefined"/"null"', () => {
    expect(toolResultText(undefined)).toBe('');
    expect(toolResultText(null)).toBe('');
  });

  test('a numeric/boolean result stringifies honestly', () => {
    expect(toolResultText(42)).toBe('42');
    expect(toolResultText(false)).toBe('false');
  });
});
