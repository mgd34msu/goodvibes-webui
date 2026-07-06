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
    const json = typeof record.toJSON === 'function' ? asRecord((record.toJSON as () => unknown)()) : {};
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

/**
 * True for the daemon's 409 SESSION_CLOSED rejection (steerMessage / followUp on a
 * session that already closed). The wire contract is `code: 'SESSION_CLOSED'`
 * (runtime-session-routes.ts, session-broker.ts); the message fallback covers the
 * `Session is closed: <sessionId>` text some paths throw before that code is attached.
 */
export function isSessionClosedError(error: unknown): boolean {
  if (errorCode(error) === 'SESSION_CLOSED') return true;
  const serialized = serializeError(error);
  const transport = asRecord(serialized.transport);
  const body = asRecord(serialized.body ?? transport.body);
  const message = [
    readString(serialized, 'message'),
    readString(body, 'message'),
    readString(body, 'error'),
  ].join(' ').toLowerCase();
  return message.includes('session is closed') || message.includes('session closed');
}

/**
 * True when a thrown request error never reached the daemon — a network/connection
 * failure rather than an HTTP rejection. The SDK transport tags these with
 * `category: 'network'` and `transport.status: 0` (createNetworkTransportError), and the
 * webui's own requestJson leaves `status` unset when fetch throws. This is what lets the
 * auth gate tell "daemon unreachable" (keep the token, reconnect) apart from a genuine
 * 401 "unauthenticated" (clear the token, show the sign-in front door).
 */
export function isDaemonUnreachableError(error: unknown): boolean {
  if (!error) return false;
  const serialized = serializeError(error);
  const transport = asRecord(serialized.transport);
  const category = readString(serialized, 'category') || readString(transport, 'category');
  if (category === 'network') return true;
  const status = readNumber(serialized, 'status') ?? readNumber(transport, 'status');
  return status === 0;
}

/**
 * True for a 401 / `category: 'authentication'` rejection — a token that was valid
 * when the request/stream opened but has since expired or been revoked. Distinct from
 * `isDaemonUnreachableError` (network/status-0, daemon unreachable): this is a genuine
 * "the daemon is answering and says you are no longer authenticated" signal, the one
 * that must hand off to the sign-in front door rather than retry forever.
 */
export function isAuthExpiredError(error: unknown): boolean {
  if (!error) return false;
  const serialized = serializeError(error);
  const transport = asRecord(serialized.transport);
  const category = readString(serialized, 'category') || readString(transport, 'category');
  if (category === 'authentication') return true;
  const status = readNumber(serialized, 'status') ?? readNumber(transport, 'status');
  return status === 401;
}

export function errorDebugValue(error: unknown): unknown {
  const serialized = serializeError(error);
  return Object.keys(serialized).length ? serialized : undefined;
}

export function compactError(error: unknown): string {
  return compactJson(serializeError(error));
}
