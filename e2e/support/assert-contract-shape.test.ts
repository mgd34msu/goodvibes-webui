/**
 * assert-contract-shape.test.ts (W6-E1) — proves the e2e fixtures actually conform to
 * the SDK's operator-contract.json, and proves the assertion is not a rubber stamp: a
 * deliberately-drifted fixture (a renamed/dropped required field, exactly the shape of
 * the provider-pills incident this closes — see seed.ts's providersResponse() header)
 * must FAIL it.
 *
 * Runs under `bun test` (a plain *.test.ts file, not a Playwright *.e2e.ts spec — see
 * playwright.config.ts's testMatch), and never touches a Page or a port: every sample
 * here comes straight from the exported, pure fixture builders in seed.ts /
 * mock-daemon.ts, the same functions installMockDaemon wires into its `page.route`
 * interceptor.
 */
import { describe, expect, test } from 'bun:test';
import { assertFixtureMatchesOperatorContract, ContractShapeError } from './assert-contract-shape';
import {
  CLOSED_SESSION,
  FOLLOWUP_SESSION,
  messagesResponse,
  providersResponse,
  STEERABLE_SESSION,
  unionListResponse,
} from './seed';
import { dispatchOutcome, methodInfoResponse } from './mock-daemon';

describe('e2e fixtures conform to the SDK operator contract (W6-E1)', () => {
  test('providers.list: providersResponse() conforms', () => {
    expect(() => assertFixtureMatchesOperatorContract('providers.list', providersResponse())).not.toThrow();
  });

  test('providers.get: every seeded provider conforms individually', () => {
    for (const provider of providersResponse().providers) {
      expect(() => assertFixtureMatchesOperatorContract('providers.get', provider)).not.toThrow();
    }
  });

  test('sessions.list: unionListResponse() (GET /api/sessions) conforms', () => {
    expect(() => assertFixtureMatchesOperatorContract('sessions.list', unionListResponse())).not.toThrow();
  });

  test('sessions.get / sessions.messages.list: messagesResponse() conforms for every seeded session', () => {
    for (const session of [STEERABLE_SESSION, FOLLOWUP_SESSION, CLOSED_SESSION]) {
      const response = messagesResponse(session.id);
      expect(() => assertFixtureMatchesOperatorContract('sessions.get', response)).not.toThrow();
      expect(() => assertFixtureMatchesOperatorContract('sessions.messages.list', response)).not.toThrow();
    }
  });

  test('sessions.messages.list: the "unknown session id" fallback still conforms', () => {
    const response = messagesResponse('no-such-session');
    expect(() => assertFixtureMatchesOperatorContract('sessions.messages.list', response)).not.toThrow();
  });

  test('sessions.steer: dispatchOutcome() conforms for a steerable (agent-bound) session', () => {
    const outcome = dispatchOutcome(STEERABLE_SESSION, 'steer', 'keep going', 'in-1');
    expect(() => assertFixtureMatchesOperatorContract('sessions.steer', outcome)).not.toThrow();
  });

  test('sessions.followUp: dispatchOutcome() conforms for a closed-agent session', () => {
    const outcome = dispatchOutcome(FOLLOWUP_SESSION, 'follow-up', 'do this next', 'fu-1');
    expect(() => assertFixtureMatchesOperatorContract('sessions.followUp', outcome)).not.toThrow();
  });

  test('sessions.steer / sessions.followUp: dispatchOutcome() conforms even for an unknown session (session: null)', () => {
    const steerOutcome = dispatchOutcome(undefined, 'steer', 'x', 'in-99');
    const followUpOutcome = dispatchOutcome(undefined, 'follow-up', 'x', 'fu-99');
    expect(() => assertFixtureMatchesOperatorContract('sessions.steer', steerOutcome)).not.toThrow();
    expect(() => assertFixtureMatchesOperatorContract('sessions.followUp', followUpOutcome)).not.toThrow();
  });

  test('control.methods.get: methodInfoResponse() conforms (the sessions.delete capability probe)', () => {
    expect(() => assertFixtureMatchesOperatorContract('control.methods.get', methodInfoResponse('sessions.delete'))).not.toThrow();
  });
});

describe('assertFixtureMatchesOperatorContract actually catches drift', () => {
  test('a renamed top-level required field on providers.get FAILS', () => {
    const [provider] = providersResponse().providers;
    // Exactly the provider-pills incident's shape: inventing a field the wire schema
    // doesn't declare while dropping one it requires.
    const { modelCount: _modelCount, ...rest } = provider;
    const drifted = { ...rest, modelTotal: 1 };
    expect(() => assertFixtureMatchesOperatorContract('providers.get', drifted)).toThrow(ContractShapeError);
  });

  test('a dropped nested required field on providers.list (runtime.auth.mode) FAILS', () => {
    const response = providersResponse();
    const [first, ...remaining] = response.providers;
    const { mode: _mode, ...authRest } = first.runtime.auth;
    const drifted = {
      providers: [
        { ...first, runtime: { ...first.runtime, auth: authRest } },
        ...remaining,
      ],
    };
    expect(() => assertFixtureMatchesOperatorContract('providers.list', drifted)).toThrow(ContractShapeError);
  });

  test('a dropped top-level required field on sessions.steer\'s output (mode) FAILS', () => {
    const outcome = dispatchOutcome(STEERABLE_SESSION, 'steer', 'keep going', 'in-1');
    const { mode: _mode, ...drifted } = outcome;
    expect(() => assertFixtureMatchesOperatorContract('sessions.steer', drifted)).toThrow(ContractShapeError);
  });

  test('a dropped required field on a nested sessions.list array item (participants) FAILS', () => {
    const response = unionListResponse();
    const [first, ...remaining] = response.sessions;
    const { participants: _participants, ...drifted } = first;
    const withDrift = { ...response, sessions: [drifted, ...remaining] };
    expect(() => assertFixtureMatchesOperatorContract('sessions.list', withDrift)).toThrow(ContractShapeError);
  });

  test('binding to a method id the installed contract no longer declares FAILS', () => {
    expect(() => assertFixtureMatchesOperatorContract('sessions.doesNotExist', {})).toThrow(ContractShapeError);
  });
});
