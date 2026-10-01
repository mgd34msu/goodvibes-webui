/**
 * Knowledge depth on the Library: consolidation candidates (knowledge.candidates.list/
 * .candidate.decide, rows on the Review tab with their decisions in the detail pane) and the
 * prompt packet builder (knowledge.packet, the Packet section of the Knowledge tab). Proven
 * against a real HTTP round-trip through the mock daemon's separate knowledge.candidates/
 * .packet registrations (mock-daemon.ts), not just a unit-mocked module.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { expectNoHorizontalScroll } from './support/app';

test('candidates render with score, and accepting one updates it honestly', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=library&tab=review');
  const row = page.locator('.knowledge-candidate-row', { hasText: 'Promote the session-spine keepalive decision' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('0.86');
  await row.getByRole('button', { name: /Promote the session-spine keepalive decision/ }).click();

  const pane = page.getByRole('region', { name: 'Review item' });
  await pane.getByRole('button', { name: 'Accept' }).click();
  // The seed's decide response marks the candidate accepted, the list refetches and the pane
  // loses its decisions (an already-decided candidate offers none).
  await expect(pane.getByRole('button', { name: 'Accept' })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test('an already-decided candidate (accepted) offers no decisions', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=library&tab=review');
  // Decided candidates sit behind a quiet disclosure.
  await page.getByText(/\d+ decided/).click();
  const decided = page.locator('.knowledge-candidate-row', { hasText: 'Refresh the daemon architecture source' });
  await expect(decided).toBeVisible();
  await decided.getByRole('button', { name: /Refresh the daemon architecture source/ }).click();
  const pane = page.getByRole('region', { name: 'Review item' });
  await expect(pane).toContainText('Already accepted in an earlier session.');
  await expect(pane.getByRole('button', { name: 'Accept' })).toHaveCount(0);
});

test('building a prompt packet renders the honest item count and each item\'s reason and score', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=library&tab=knowledge');
  await page.getByRole('radio', { name: 'Packet' }).click();
  await page.getByLabel('Task description').fill('Refactor the session spine');
  await page.getByRole('button', { name: 'Build packet' }).click();
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
  // truncated/totalCandidates/droppedCount subset, proving the disclosure renders from
  // a genuine final-SDK wire response.
  await installMockDaemon(page, { packet: 'truncated' });
  await page.goto('/?view=library&tab=knowledge');
  await page.getByRole('radio', { name: 'Packet' }).click();
  await page.getByLabel('Task description').fill('Refactor the session spine');
  await page.getByRole('button', { name: 'Build packet' }).click();
  const packetPanel = page.locator('.knowledge-packet__result');
  await expect(packetPanel).toBeVisible();
  const note = page.locator('.knowledge-packet__truncation-note');
  await expect(note).toBeVisible();
  await expect(note).toContainText('Showing 1 of 20 candidates (19 dropped)');
  await expectNoHorizontalScroll(page);
});
