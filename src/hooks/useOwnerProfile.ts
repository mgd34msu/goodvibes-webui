/**
 * useOwnerProfile — the queries and mutations behind the owner-profile settings card
 * (profile.* verbs, docs/owner-profile.md §11.1).
 *
 * Same shape as usePowerStatus/useMemoryDiagnostics: one query per verb, a defensive
 * wire parse in the queryFn (lib/owner-profile.ts's readProfile* readers), and an honest
 * retriable error when the daemon answers 200 with a body that is not a profile. The
 * distinction that matters here is that "the profile could not be read" is a SUCCESSFUL
 * response carrying `state: 'unavailable'` and a reason — not a query error — because
 * §4.4 requires that state to be stated rather than rendered as an empty profile.
 *
 * No wire event exists for this domain, so nothing rides useRealtimeInvalidation; each
 * mutation invalidates the document and the status itself.
 *
 * CONTAINMENT (§11.3): every value stays in react-query's in-memory cache and in React
 * state. Nothing here writes to localStorage/sessionStorage/IndexedDB, and nothing here
 * logs — a profile value must not reach a console, a persisted cache, or a diagnostic
 * view on this surface.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sdk } from '../lib/goodvibes';
import { queryKeys } from '../lib/queries';
import {
  profileTargetId,
  profileTargetInput,
  readProfileDocument,
  readProfileForgetOutcome,
  readProfileProvenanceAnswer,
  readProfileStatus,
  readProfileWriteOutcome,
  SETTINGS_EDIT_UTTERANCE,
  WEBUI_PROFILE_SURFACE,
  type ProfileDocument,
  type ProfileForgetOutcome,
  type ProfileProvenanceAnswer,
  type ProfileStatus,
  type ProfileTarget,
  type ProfileWriteOutcome,
} from '../lib/owner-profile';

const MALFORMED_DOCUMENT =
  'The daemon answered, but its response did not carry an owner profile.';
const MALFORMED_STATUS =
  'The daemon answered, but its response did not carry the profile’s load state.';
const MALFORMED_PROVENANCE =
  'The daemon answered, but its response did not carry any provenance for this line.';

export function useOwnerProfileDocument() {
  return useQuery<ProfileDocument>({
    queryKey: queryKeys.ownerProfile,
    queryFn: async () => {
      const raw = await sdk.operator.profile.read();
      const document = readProfileDocument(raw);
      if (!document) throw new Error(MALFORMED_DOCUMENT);
      return document;
    },
    staleTime: 10_000,
    retry: false,
  });
}

export function useOwnerProfileStatus() {
  return useQuery<ProfileStatus>({
    queryKey: queryKeys.ownerProfileStatus,
    queryFn: async () => {
      const raw = await sdk.operator.profile.status();
      const status = readProfileStatus(raw);
      if (!status) throw new Error(MALFORMED_STATUS);
      return status;
    },
    staleTime: 10_000,
    retry: false,
  });
}

/**
 * One line's provenance, fetched only once the operator asks for it — reachable per
 * line, never a bulk dump (§8.3). `target` is null for a line this daemon build gives no
 * address at all, in which case nothing is fetched and the card says so.
 */
export function useOwnerProfileProvenance(target: ProfileTarget | null) {
  return useQuery<ProfileProvenanceAnswer>({
    queryKey: queryKeys.ownerProfileProvenance(target ? profileTargetId(target) : 'none'),
    queryFn: async () => {
      if (!target) throw new Error('This line has no address, so its provenance cannot be looked up.');
      const raw = await sdk.operator.profile.provenance(profileTargetInput(target));
      const answer = readProfileProvenanceAnswer(raw);
      if (!answer) throw new Error(MALFORMED_PROVENANCE);
      return answer;
    },
    enabled: target !== null,
    staleTime: 10_000,
    retry: false,
  });
}

/**
 * A field edit. Per §9.3 this is a supersede, not a silent overwrite: the previous value
 * moves into a `<!-- was: … -->` comment and profile.undo can promote it back. The write
 * carries this surface's name and §7 layer 3's settings-surface utterance, so the line's
 * provenance stays answerable.
 */
export function useSetOwnerProfileField() {
  const queryClient = useQueryClient();
  return useMutation<ProfileWriteOutcome, unknown, { key: string; value: string }>({
    mutationFn: async ({ key, value }) => {
      const raw = await sdk.operator.profile.set({
        key,
        value,
        surface: WEBUI_PROFILE_SURFACE,
        said: SETTINGS_EDIT_UTTERANCE,
      });
      return readProfileWriteOutcome(raw);
    },
    onSettled: async () => {
      await invalidateProfile(queryClient);
    },
  });
}

/** A new prose bullet in a prose-only section (§6). Same provenance rules as an edit. */
export function useAppendOwnerProfileLine() {
  const queryClient = useQueryClient();
  return useMutation<ProfileWriteOutcome, unknown, { section: string; text: string }>({
    mutationFn: async ({ section, text }) => {
      const raw = await sdk.operator.profile.append({
        section,
        text,
        surface: WEBUI_PROFILE_SURFACE,
        said: SETTINGS_EDIT_UTTERANCE,
      });
      return readProfileWriteOutcome(raw);
    },
    onSettled: async () => {
      await invalidateProfile(queryClient);
    },
  });
}

/**
 * Delete, permanently — no tombstone, no retention window, and every `<!-- was: … -->`
 * comment for that field goes with it (§9.2, docs/decisions/2026-07-06-delete-means-delete.md).
 * The outcome is three-way so the card can report what actually went and never paint a
 * success for a line that was not there.
 */
export function useForgetOwnerProfile() {
  const queryClient = useQueryClient();
  return useMutation<ProfileForgetOutcome, unknown, ProfileTarget>({
    mutationFn: async (target) => {
      const raw = await sdk.operator.profile.forget(profileTargetInput(target));
      return readProfileForgetOutcome(raw);
    },
    onSettled: async () => {
      await invalidateProfile(queryClient);
    },
  });
}

/** Promote the most recent superseded value back (§9.1) — the recovery for a wrong edit. */
export function useUndoOwnerProfile() {
  const queryClient = useQueryClient();
  return useMutation<ProfileWriteOutcome, unknown, ProfileTarget>({
    mutationFn: async (target) => {
      const raw = await sdk.operator.profile.undo(profileTargetInput(target));
      return readProfileWriteOutcome(raw);
    },
    onSettled: async () => {
      await invalidateProfile(queryClient);
    },
  });
}

/** Every write can change the document, its counts, and any line's provenance history. */
async function invalidateProfile(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ['owner-profile'] });
}
