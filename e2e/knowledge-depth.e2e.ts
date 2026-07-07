/**
 * Knowledge view depth — consolidation candidates (knowledge.candidates.list/
 * .candidate.decide) and the prompt packet builder (knowledge.packet), both
 * never-called-before verbs this brief adopts. Proven against a real HTTP
 * round-trip through the mock daemon's separate knowledge.candidates/.packet
 * registrations (mock-daemon.ts), not just a unit-mocked module.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { expectNoHorizontalScroll } from './support/app';

test('candidates render with score/status, and accept updates the row honestly', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=knowledge');
  const candidateRow = page.locator('.knowledge-candidate-row', { hasText: 'Promote the session-spine keepalive decision' });
  await expect(candidateRow).toBeVisible();
  await expect(candidateRow).toContainText('0.86');
  await candidateRow.getByRole('button', { name: 'Accept' }).click();
  // The seed's decide response marks the candidate accepted — the list refetches
  // and the row loses its action buttons (an already-decided candidate offers none).
  await expect(candidateRow.getByRole('button', { name: 'Accept' })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test('an already-decided candidate (accepted) shows no action buttons from the start', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=knowledge');
  const decidedRow = page.locator('.knowledge-candidate-row', { hasText: 'Refresh the daemon architecture source' });
  await expect(decidedRow).toBeVisible();
  await expect(decidedRow.locator('.knowledge-candidate-row__actions')).toHaveCount(0);
});

test('building a prompt packet renders the honest item count and each item\'s reason/score', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=knowledge');
  await page.getByLabel('Task description').fill('Refactor the session spine');
  await page.getByRole('button', { name: 'Build Packet' }).click();
  const packetPanel = page.locator('.knowledge-packet__result');
  await expect(packetPanel).toBeVisible();
  await expect(packetPanel).toContainText('1 item');
  await expect(packetPanel).toContainText('Session spine decision record');
  await expect(packetPanel).toContainText('directly relevant to the task');
  await expectNoHorizontalScroll(page);
});

test('a real post-1.2.0 truncated packet (the final SDK\'s full field shape) renders the truncation disclosure', async ({ page }) => {
  // packet: 'truncated' answers truncated/totalCandidates/droppedCount/droppedForBudget/
  // budgetExhausted all populated (packet.ts's real shape), not just the hand-authored
  // truncated/totalCandidates/droppedCount subset — proving the disclosure renders from
  // a genuine final-SDK wire response.
  await installMockDaemon(page, { packet: 'truncated' });
  await page.goto('/?view=knowledge');
  await page.getByLabel('Task description').fill('Refactor the session spine');
  await page.getByRole('button', { name: 'Build Packet' }).click();
  const packetPanel = page.locator('.knowledge-packet__result');
  await expect(packetPanel).toBeVisible();
  const note = page.locator('.knowledge-packet__truncation-note');
  await expect(note).toBeVisible();
  await expect(note).toContainText('Showing 1 of 20 candidates (19 dropped)');
  await expectNoHorizontalScroll(page);
});
