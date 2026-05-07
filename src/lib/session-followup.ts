import { firstString, readPath } from './object';

export type FollowUpUiState = 'running' | 'queued' | 'rejected' | 'submitted';

export interface FollowUpDisposition {
  state: FollowUpUiState;
  error?: string;
}

export function followUpDisposition(result: unknown): FollowUpDisposition {
  const mode = firstString(result, ['mode']);
  const agentId = firstString(result, ['agentId']);
  const input = readPath(result, ['input']);
  const inputState = firstString(input, ['state']);
  const inputError = firstString(input, ['error']);

  if (mode === 'rejected' || inputState === 'rejected' || inputState === 'failed') {
    return {
      state: 'rejected',
      ...(inputError ? { error: inputError } : {}),
    };
  }

  if (mode === 'queued-follow-up' || inputState === 'queued') {
    return { state: 'queued' };
  }

  if (mode === 'spawn' || mode === 'continued-live' || inputState === 'spawned' || agentId) {
    return { state: 'running' };
  }

  return { state: 'submitted' };
}
