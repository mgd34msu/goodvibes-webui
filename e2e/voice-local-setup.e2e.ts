/**
 * Local voice setup — the one-act managed provisioning flow (voice.local.status /
 * voice.local.install, SDK 1.9.0-dev), proven end to end against the hermetic voice
 * mock inside the voice-settings popover:
 *   - unprovisioned -> a size-labeled "Set up local voice" action.
 *   - install -> the final receipt (per-engine outcomes + configured-vs-skipped keys)
 *     and the resting display flipping to Installed.
 *   - a retriable download failure -> the honest reason plus a Retry action.
 *   - unsupported platform -> an honest note, no setup button.
 *   - an older daemon build (verb absent, 404) -> the section stays absent entirely.
 */
import { test, expect } from '@playwright/test';
import { installChatMockDaemon } from './support/chat-mock';
import { installVoiceRoutes } from './support/voice-mock';

async function openVoiceSettings(page: import('@playwright/test').Page) {
  await page.goto('/?view=chat');
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.locator('.voice-settings-btn').click();
  const popover = page.locator('.voice-settings-popover');
  await expect(popover).toBeVisible();
  return popover;
}

test('an unprovisioned runtime offers the size-labeled one-act setup, and installing renders the receipt', async ({ page }) => {
  await installChatMockDaemon(page);
  const voice = await installVoiceRoutes(page); // default: not-provisioned, install succeeds

  const popover = await openVoiceSettings(page);
  const local = popover.locator('.voice-settings-local');
  await expect(local).toBeVisible();

  // The action is size-labeled from the daemon's own offerBytes — never an unlabeled download.
  const setup = local.getByRole('button', { name: /Set up local voice/ });
  await expect(setup).toBeVisible();
  await expect(setup).toContainText('209.0 MB');

  await setup.click();

  // The final receipt: per-engine outcomes, configured keys, and the skipped-as-user-set key.
  await expect(local).toContainText('TTS (piper): Installed');
  await expect(local).toContainText('STT (whisper-cpp): Installed');
  await expect(local).toContainText('Configured: voice.local.ttsEngine, voice.local.ttsBinary, voice.local.ttsModelPath');
  await expect(local).toContainText('Left as you set them: voice.local.sttBinary');
  expect(voice.localInstallRequests).toBe(1);
});

test('a retriable download failure renders the honest reason and a Retry action that re-invokes install', async ({ page }) => {
  await installChatMockDaemon(page);
  const voice = await installVoiceRoutes(page, { localInstallOutcome: 'download-failed' });

  const popover = await openVoiceSettings(page);
  const local = popover.locator('.voice-settings-local');
  await local.getByRole('button', { name: /Set up local voice/ }).click();

  await expect(local).toContainText('TTS (piper): Download failed — network timeout fetching piper.tar.gz');
  const retry = local.getByRole('button', { name: 'Retry' });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect.poll(() => voice.localInstallRequests).toBe(2);
});

test('a provisioned runtime shows the quiet installed line, no setup button', async ({ page }) => {
  await installChatMockDaemon(page);
  await installVoiceRoutes(page, { localRuntime: 'provisioned' });

  const popover = await openVoiceSettings(page);
  const local = popover.locator('.voice-settings-local');
  await expect(local).toContainText('Installed — TTS: piper, STT: whisper-cpp.');
  await expect(local.getByRole('button', { name: /Set up local voice/ })).toHaveCount(0);
});

test('an unsupported platform reports honestly instead of offering an install that cannot succeed', async ({ page }) => {
  await installChatMockDaemon(page);
  await installVoiceRoutes(page, { localRuntime: 'unsupported-platform' });

  const popover = await openVoiceSettings(page);
  const local = popover.locator('.voice-settings-local');
  await expect(local).toContainText('Not supported on this platform — no pinned engine build exists for this host.');
  await expect(local.getByRole('button', { name: /Set up local voice/ })).toHaveCount(0);
});

test('an older daemon build (voice.local.status 404s) renders no local section at all — honest omission, not an error banner', async ({ page }) => {
  await installChatMockDaemon(page);
  await installVoiceRoutes(page, { localRuntime: 'unavailable' });

  const popover = await openVoiceSettings(page);
  // The rest of the popover works untouched.
  await expect(popover).toContainText('Spoken voice');
  await expect(popover.locator('.voice-settings-local')).toHaveCount(0);
});
