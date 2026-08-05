/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 * Produced by scripts/generate-config-ownership.ts from the installed
 * @pellux/goodvibes-sdk: DAEMON_OWNED_CONFIG_PREFIXES, DAEMON_OWNED_CONFIG_KEYS
 * and DAEMON_OWNED_NON_SCHEMA_CONFIG_PATHS (platform/config).
 *
 * This is a build-time snapshot so the browser bundle never imports the SDK
 * config barrel (which drags SecretsManager / OAuth / google-auth — node-only).
 *
 * Regenerate: `bun run config-ownership:generate`.
 * Verify (no write): `bun run config-ownership:check` — wired into `bun run build`,
 * so an SDK ownership change that was not regenerated fails the build.
 */

export const DAEMON_OWNED_CONFIG_PREFIXES: readonly string[] = [
  "surfaces.",
  "controlPlane.",
  "httpListener.",
  "web.",
  "relay.",
  "watchers.",
  "device.",
  "automation.",
  "checkin.",
  "integrations.",
  "atRest.",
  "payments.",
  "voice.local.",
  "conversationGate.",
  "hostedSessions.",
  "cluster.",
  "profile.",
  "occasions.",
  "email.",
  "calendar.",
  "google."
] as const;

export const DAEMON_OWNED_CONFIG_KEYS: readonly string[] = [
  "danger.httpListener",
  "daemon.timezone"
] as const;

export const DAEMON_OWNED_NON_SCHEMA_CONFIG_PATHS: readonly string[] = [
  "conversationGate.gatedSurfaces",
  "cluster.peers",
  "cluster.groupMaterial"
] as const;
