import { asRecord, compactJson } from './object';

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : '';
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (!error) return {};
  if (error instanceof Error) {
    const record = asRecord(error);
    const json = typeof record.toJSON === 'function' ? asRecord(record.toJSON()) : {};
    return {
      name: error.name,
      message: error.message,
      ...json,
      ...record,
    };
  }
  return asRecord(error);
}

export function formatError(error: unknown): string {
  if (!error) return '';

  const serialized = serializeError(error);
  const transport = asRecord(serialized.transport);
  const body = serialized.body ?? transport.body;
  const message = readString(serialized, 'message')
    || readString(asRecord(body), 'message')
    || readString(asRecord(body), 'error')
    || (typeof error === 'string' ? error : 'Request failed');
  const status = readNumber(serialized, 'status') ?? readNumber(transport, 'status');
  const category = readString(serialized, 'category');
  const hint = readString(serialized, 'hint');

  const details = [
    status ? `HTTP ${status}` : '',
    category && category !== 'unknown' ? category : '',
    hint,
  ].filter(Boolean);

  return details.length ? `${message} (${details.join(' · ')})` : message;
}

export function errorCode(error: unknown): string {
  const serialized = serializeError(error);
  const transport = asRecord(serialized.transport);
  const body = asRecord(serialized.body ?? transport.body);
  return readString(serialized, 'code')
    || readString(body, 'code')
    || readString(asRecord(body.error), 'code')
    || '';
}

export function isSessionNotFoundError(error: unknown): boolean {
  if (errorCode(error) === 'SESSION_NOT_FOUND') return true;
  const serialized = serializeError(error);
  const transport = asRecord(serialized.transport);
  const body = asRecord(serialized.body ?? transport.body);
  const message = [
    readString(serialized, 'message'),
    readString(body, 'message'),
    readString(body, 'error'),
  ].join(' ').toLowerCase();
  return message.includes('session not found');
}

export function errorDebugValue(error: unknown): unknown {
  const serialized = serializeError(error);
  return Object.keys(serialized).length ? serialized : undefined;
}

export function compactError(error: unknown): string {
  return compactJson(serializeError(error));
}
