/**
 * Approvals depth — remember tiers, the pending queue, the exec-prompt
 * answerable card, deny with a reason, and the durable-rules view. Runs on
 * BOTH phone and desktop; the mock daemon mirrors the broker's decision
 * shapes (decision.rememberTier / decision.modifiedArgs.answer on the
 * returned record) and its remembered-decision sweep, so every honesty path
 * here exercises the same response-verified reporting a supporting daemon
 * would drive.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { expectNoHorizontalScroll } from './support/app';
import {
  EXEC_PROMPT_APPROVAL,
  PENDING_APPROVAL,
  PENDING_APPROVAL_SAME_CLASS,
  SEEDED_PERMISSION_RULE,
} from './support/seed';

test('multiple pending asks render as a reachable queue, newest first', async ({ page }) => {
  await installMockDaemon(page, { approvals: [PENDING_APPROVAL, PENDING_APPROVAL_SAME_CLASS] });
  await page.goto('/?view=approvals-tasks');
  await expect(page.locator('.approvals-toolbar__summary').first()).toContainText('2 pending');
  const cards = page.locator('.approval-card');
  await expect(cards).toHaveCount(2);
  // Newest first: the later-created same-class ask leads.
  await expect(cards.first()).toContainText('Typecheck the workspace');
  await expect(cards.last()).toContainText('Run the full test suite before merging');
  await expectNoHorizontalScroll(page);
});

test('an approval granted at the command-class tier records a rule and suppresses the next identical ask', async ({ page }) => {
  const daemon = await installMockDaemon(page, { approvals: [PENDING_APPROVAL, PENDING_APPROVAL_SAME_CLASS] });
  await page.goto('/?view=approvals-tasks');
  const card = page.locator('.approval-card', { hasText: 'Run the full test suite before merging' });
  // The ask's own rememberOptions render verbatim; pick the command class.
  await card.getByLabel('Remember scope for bash').selectOption('command-class');
  await expect(card.getByText('bun ...')).toBeVisible();
  await card.getByRole('button', { name: 'Approve', exact: true }).click();

  // The response carried the recorded tier — reported as remembered, never assumed.
  await expect(page.getByText('Remembered (command-class)')).toBeVisible();
  expect(daemon.approvalActions[0]).toMatchObject({
    approvalId: PENDING_APPROVAL.id,
    action: 'approve',
    body: { remember: true, rememberTier: 'command-class' },
  });

  // The remembered decision swept the identical pending ask — nothing left to answer.
  await expect(page.locator('.approvals-toolbar__summary').first()).toContainText('0 pending');
  // …and the durable rule is now listed in the rules view.
  const rules = page.locator('[data-testid="permission-rules"]');
  await expect(rules).toContainText('Allow · command-class · bash');
  await expectNoHorizontalScroll(page);
});

test('deny accepts an optional reason that rides the wire with the denial', async ({ page }) => {
  const daemon = await installMockDaemon(page, { approvals: [PENDING_APPROVAL] });
  await page.goto('/?view=approvals-tasks');
  const card = page.locator('.approval-card', { hasText: 'Run the full test suite before merging' });
  await card.locator('.approval-card__deny-reason summary').click();
  await card.getByLabel('Deny reason for bash').fill('wrong branch — run it on main');
  await card.getByRole('button', { name: 'Deny' }).click();
  await expect(page.getByText('Reason fed back with the denial.')).toBeVisible();
  expect(daemon.approvalActions[0]).toMatchObject({
    approvalId: PENDING_APPROVAL.id,
    action: 'deny',
    body: { note: 'wrong branch — run it on main', reason: 'wrong branch — run it on main' },
  });
});

test('a command waiting on stdin renders as an answerable card and the typed reply feeds the run', async ({ page }) => {
  const daemon = await installMockDaemon(page, { approvals: [EXEC_PROMPT_APPROVAL] });
  await page.goto('/?view=approvals-tasks');
  const card = page.locator('[data-testid="exec-prompt-card"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('ssh deploy@staging.internal');
  await expect(card).toContainText("Continue connecting (yes/no)?");
  await expect(card.locator('.approval-card__exec-output')).toContainText('ED25519 key fingerprint');

  const send = card.getByRole('button', { name: 'Send answer' });
  await expect(send).toBeDisabled();
  await card.getByLabel('Answer for ssh deploy@staging.internal').fill('yes');
  await send.click();
  await expect(page.getByText('Answer sent')).toBeVisible();
  expect(daemon.approvalActions[0]).toMatchObject({
    approvalId: EXEC_PROMPT_APPROVAL.id,
    action: 'approve',
    body: { modifiedArgs: { answer: 'yes' } },
  });
  await expectNoHorizontalScroll(page);
});

test('the durable-rules view lists seeded rules and delete revokes one', async ({ page }) => {
  await installMockDaemon(page, { permissionRules: [SEEDED_PERMISSION_RULE] });
  await page.goto('/?view=approvals-tasks');
  const rules = page.locator('[data-testid="permission-rules"]');
  await expect(rules).toContainText('1 durable');
  await expect(rules).toContainText('Allow · path · edit');
  await expect(rules).toContainText('edits under src/**');
  await rules.getByRole('button', { name: /Delete rule: Allow · path · edit/ }).click();
  await expect(page.getByText('Rule deleted')).toBeVisible();
  await expect(rules).toContainText('No durable approval rules');
  await expectNoHorizontalScroll(page);
});
