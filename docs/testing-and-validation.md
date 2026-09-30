# Testing and validation

## What runs where

| When | What | Command |
|------|------|---------|
| While you work | the unit test files your change affects, the files and specs you touched, a typecheck at the end | `bun run test:changed`, `bun test <file>`, `bunx playwright test <spec> --project phone`, `bun run typecheck` |
| Every push to `main` and every PR (`ci.yml`) | typecheck and the workflow structure check, lint, one unit run, the build and the SDK pin agreement, Playwright's phone project | CI |
| Before a push that releases, nightly, on demand (`release-gates.yml`) | Playwright's desktop and lan-origin projects (before a release); every project (nightly, on demand) | CI |
| Version bump | the SDK-derived modules, `index.html` cache-bust values, README badges, workflow pins, the CHANGELOG section | `bun run release:prepare` |

Local work never needs the whole unit suite or the whole Playwright matrix. CI
runs them, each once.

## Local commands

```bash
bun run test:changed                          # unit files affected by changes since origin/main
bun test src/lib/settings-model.test.ts       # one unit file
bun run typecheck                             # src/, scripts/ and e2e/, and every file is in a project
bun run lint                                  # ESLint
bunx playwright test e2e/chat-session-switch.e2e.ts --project phone   # one spec, one project

bun run test                                  # the whole unit suite (what CI runs)
bun run e2e:phone                             # the per-push Playwright project
bun run e2e                                   # every Playwright project
```

`test:changed` is `bun test --changed=origin/main --isolate`: Bun runs only the
test files whose import graph reaches a file changed since `origin/main`,
committed or not. `bun test --changed=<ref> --isolate` takes another base.

## Test layers

- **Unit** (`bun test`, `*.test.ts` / `*.test.tsx` beside the code, happy-dom
  preloaded by `src/test-setup.ts`). A module, hook or component called with
  real inputs. Fakes stand in only for what is outside the unit: the daemon
  wire, the clock, browser APIs happy-dom lacks. Timing is driven with
  `jest.useFakeTimers()` and `jest.advanceTimersByTime()`, or by awaiting a
  condition; a test never sleeps on the real clock and hopes the work finished.
- **Scripts** (`scripts/*.test.ts`). The generators, `release-prepare`,
  `check-workflows`, the bundle packer and the temp-directory containment,
  each exercised through its functions or as a subprocess against fixtures.
- **End to end** (Playwright, `e2e/*.e2e.ts`). The real app in Chromium against
  the in-page mock daemon (`e2e/support/mock-daemon.ts`,
  `e2e/support/chat-mock.ts`), which answers every daemon call from a seeded,
  stateful fixture. No real daemon or network. Every test owns its browser
  context and mock, so the suite runs `fullyParallel` on 4 workers. Waits are
  on conditions the page exposes (an element, a mock's recorded call, audio
  actually flowing, the next painted frames), never `waitForTimeout`.

Playwright projects (`playwright.config.ts`):

| Project | Viewport | Runs |
|---------|----------|------|
| `phone` | 390x844, touch, mobile | every push |
| `desktop` | 1280x800 | before a release, nightly |
| `lan-origin` | 1280x800, served from the host's own private-network address | before a release, nightly (skips itself on a host without one) |

Three web servers back them: the vite dev server on 4318 (phone, desktop), a
production build served by `vite preview` on 4320 (only `pwa-offline.e2e.ts`
uses it, since the service worker caches only built assets), and, when the
host has a private-network address, a second dev server on it for
`lan-origin`.

A test earns its place by failing when behavior breaks. Tests that read
source, docs or workflow files as text, pin wording, constants or the size of
an SDK-owned schema, assert a mock's own return value, or only check that
something is defined do not; neither do checks that a generated file matches
its generator, since the file is regenerated at the bump. They were removed in
the 2026-09 overhaul and should not come back. Before adding a test, break the
behavior it covers and watch it fail.

## Per-push CI (`ci.yml`)

| Job | Command | Purpose |
|-----|---------|---------|
| `typecheck` | `bun run typecheck`, `bun run workflows:check` | tsc over every project, every TypeScript file inside one; every workflow parses, no job-level `continue-on-error`, every `needs` exists, `auto-release` needs every other job |
| `lint` | `bun run lint` | ESLint |
| `test` | `bun run test` | The unit suite, once |
| `build` | `bun run build`, `bun run release:gate` | `vite build`; the SDK pin, lockfile and installed version agree and imports resolve through the SDK exports map |
| `e2e` | `bun run e2e:phone` | Playwright, phone project |
| `release-intent` | `git ls-remote` | Pushes to `main` only: does this version still need a tag? |
| `release-gates` | `release-gates.yml` | Only when the push releases: the desktop and lan-origin projects |
| `auto-release` | tag, bundle, GitHub release | Only when the push releases, after every job above |

Superseded PR runs are cancelled; runs for pushes to `main` never are.

## Release gates (`release-gates.yml`)

One job, `e2e`. Called from `ci.yml` it runs
`bunx playwright test --project=desktop --project=lan-origin`, so with the
per-push phone job each project runs once for the released commit. Nightly
(07:45 UTC) and on demand it runs every project.

## Version bump: `bun run release:prepare`

Everything that carries the version or is generated from the installed SDK is
written at the bump, never checked per push:

```bash
bun run release:prepare --patch         # or --minor, --major, --version X.Y.Z
bun run release:prepare --no-bump       # regenerate at the current version
```

It sets `package.json`'s version, relocks (`bun install`), regenerates
`src/lib/generated/config-schema.ts`, `src/lib/generated/config-ownership.ts`
and the presentation tokens (`src/lib/generated/presentation-tokens.ts`,
`src/styles/generated/presentation-tokens.css`) in fresh processes against the
relocked SDK, sets every `?v=` cache-bust value in `index.html` and the README
version badges, points any SDK reusable-workflow reference in
`.github/workflows` at the commit the pinned SDK version's tag names and any
toolchain spec at the pinned toolchain, and scaffolds the CHANGELOG section. It
never commits, tags or pushes. `npm version` runs it through the `version`
script. `--no-install`, `--no-pins` and `--no-changelog` skip those steps.
