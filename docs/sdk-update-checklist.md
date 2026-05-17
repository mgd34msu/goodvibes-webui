# SDK Update Checklist

Use this checklist for routine `@pellux/goodvibes-sdk` updates.

## Preconditions

- The SDK version is published on npm.
- If the update depends on daemon/TUI runtime behavior, wait for a TUI/daemon
  handoff confirming the installed daemon reports the expected SDK version.
- Do not use a local SDK checkout.
- Do not edit package versions by hand and assume the install happened.

## Commands

Check npm latest:

```bash
npm view @pellux/goodvibes-sdk version
```

Install the exact version:

```bash
bun add @pellux/goodvibes-sdk@<version>
```

Verify the installed package:

```bash
node -p "require('./node_modules/@pellux/goodvibes-sdk/package.json').version"
```

Verify `package.json`:

```bash
node -p "require('./package.json').dependencies['@pellux/goodvibes-sdk']"
```

Verify `bun.lock`:

```bash
rg -n "<version>|@pellux/goodvibes-sdk" bun.lock package.json
```

Clear Vite optimized deps:

```bash
rm -rf node_modules/.vite
```

Run local CI:

```bash
bun run ci
```

## Version and Changelog

Bump WebUI patch version in `package.json`.

Add a `CHANGELOG.md` entry:

```md
## [0.1.X] - YYYY-MM-DD

### Changed

- Updated `@pellux/goodvibes-sdk` to `<version>`.
```

Update cache-bust values in `index.html` to the new WebUI version.

## Source Checks

Confirm no accidental local SDK or extension-specific code was introduced:

```bash
rg -n "file:|link:|\\.\\./.*goodvibes-sdk" package.json bun.lock
rg -n "homeassistant|homeGraph|HomeGraph|includeAllSpaces|knowledgeSpaceId" src || true
rg -n "wrfc|workmap|owner_decision|owner decision|route selector|resume hooks" src || true
```

The second and third checks are not always errors, but they force an explicit
review. Do not add WRFC/workmap surfaces unless there is a WebUI-facing product
request and SDK handoff. Do not add Home Graph behavior to regular Knowledge.

## Commit, Tag, Push

```bash
git add CHANGELOG.md bun.lock index.html package.json
git commit -m "Update GoodVibes SDK to <version>"
git tag v<webui-version>
git push origin main --tags
```

If code changes are required by the SDK handoff, include those files in the
commit and use a message that names the behavior, not only the dependency bump.

## Restart Dev Server

Stop existing Vite processes and restart with fresh optimized deps:

```bash
pgrep -af "node .*vite|vite --force|bun.*vite" || true
kill <pid>
rm -rf node_modules/.vite
setsid node ./node_modules/.bin/vite --force > /tmp/goodvibes-webui-vite.log 2>&1 < /dev/null &
```

Verify:

```bash
sed -n '1,120p' /tmp/goodvibes-webui-vite.log
ss -ltnp | rg ':3423'
curl -sS --max-time 3 http://127.0.0.1:3423/ | rg '<webui-version>'
node -p "require('./node_modules/@pellux/goodvibes-sdk/package.json').version"
```

## GitHub CI

Check the pushed run:

```bash
gh run list --limit 5
gh run watch <run-id> --exit-status
```

Do not call an SDK update complete until:

- `node_modules` reports the new SDK version
- `bun.lock` changed
- local CI passed
- GitHub CI passed
- the dev server was restarted and is serving the new WebUI version
