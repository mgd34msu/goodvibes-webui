/**
 * Approvals depth, remember tiers, the pending queue, the exec-prompt
 * answerable card, deny with a reason, and the durable-rules view. Runs on
 * BOTH phone and desktop; the mock daemon forwards the decision fields into
 * resolution and returns the authoritative `recorded` block
 * (rememberTier / reasonStored / modifiedArgsDelivered) plus its
 * remembered-decision sweep, so every honesty path here exercises the same
 * recorded-block reporting a supporting daemon drives, the UI claims only
 * what the daemon actually recorded.
 */
import { test, expect, type Page } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { detailPane, expectNoHorizontalScroll, openRow } from './support/app';
import {
  EXEC_PROMPT_APPROVAL,
  PENDING_APPROVAL,
  PENDING_APPROVAL_SAME_CLASS,
  SEEDED_PERMISSION_RULE,
} from './support/seed';

function needsYou(page: Page) {
  return page.getByRole('region', { name: 'Needs you' });
}

test('multiple pending asks render under Needs you, newest first', async ({ page }) => {
  await installMockDaemon(page, { approvals: [PENDING_APPROVAL, PENDING_APPROVAL_SAME_CLASS] });
  // The old Approvals link lands on Work.
  await page.goto('/?view=approvals-tasks');
  const approvals = needsYou(page).locator('.gv-row', { hasText: /^Approve bash/ });
  await expect(approvals).toHaveCount(2);
  // Newest first: the later-created same-class ask leads.
  await expect(approvals.first()).toContainText('Typecheck the workspace');
  await expect(approvals.last()).toContainText('Run the full test suite before merging');
  await expectNoHorizontalScroll(page);
});

test('an approval granted at the command-class tier records a rule and suppresses the next identical ask', async ({ page }) => {
  const daemon = await installMockDaemon(page, { approvals: [PENDING_APPROVAL, PENDING_APPROVAL_SAME_CLASS] });
  await page.goto('/?view=work');
  const detail = await openRow(page, 'Run the full test suite before merging');
  // The command sits in a code frame.
  await expect(detail.locator('.dv-code')).toContainText('bun test --isolate');
  // The ask's own rememberOptions render verbatim in a kit Select; pick the command class.
  await detail.getByRole('button', { name: 'Remember scope for bash' }).click();
  await page.getByRole('option', { name: /every bun command/ }).click();
  await expect(detail.getByText('bun ...')).toBeVisible();
  await detail.getByRole('button', { name: 'Approve', exact: true }).click();

  // The response carried the recorded tier, reported as remembered, never assumed.
  await expect(page.getByText('Remembered (command-class)')).toBeVisible();
  expect(daemon.approvalActions[0]).toMatchObject({
    approvalId: PENDING_APPROVAL.id,
    action: 'approve',
    body: { remember: true, rememberTier: 'command-class' },
  });

  // The remembered decision swept the identical pending ask: nothing left to answer.
  await expect(needsYou(page).locator('.gv-row', { hasText: /^Approve bash/ })).toHaveCount(0);
  // …and the durable rule is listed in Settings, Permissions.
  await page.goto('/?view=work&settings=permissions');
  const rules = page.locator('[data-testid="permission-rules"]');
  await expect(rules).toContainText('Allow · command-class · bash');
  await expectNoHorizontalScroll(page);
});

test('deny accepts an optional reason that rides the wire with the denial', async ({ page }) => {
  const daemon = await installMockDaemon(page, { approvals: [PENDING_APPROVAL] });
  await page.goto('/?view=work');
  const detail = await openRow(page, 'Run the full test suite before merging');
  await detail.getByText('Add a reason for denying').click();
  await detail.getByLabel('Deny reason for bash').fill('wrong branch: run it on main');
  await detail.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(page.getByText('Reason fed back with the denial.')).toBeVisible();
  expect(daemon.approvalActions[0]).toMatchObject({
    approvalId: PENDING_APPROVAL.id,
    action: 'deny',
    body: { note: 'wrong branch: run it on main', reason: 'wrong branch: run it on main' },
  });
});

test('a command waiting on stdin is answerable and the typed reply feeds the run', async ({ page }) => {
  const daemon = await installMockDaemon(page, { approvals: [EXEC_PROMPT_APPROVAL] });
  await page.goto('/?view=work');
  const detail = await openRow(page, 'Continue connecting (yes/no)?');
  await expect(detail).toContainText('ssh deploy@staging.internal');
  await expect(detail).toContainText('Continue connecting (yes/no)?');
  await expect(detail.locator('.dv-code', { hasText: 'Recent output' })).toContainText('ED25519 key fingerprint');

  const send = detailPane(page).getByRole('button', { name: 'Send answer' });
  await expect(send).toBeDisabled();
  await detail.getByLabel('Answer for ssh deploy@staging.internal').fill('yes');
  await send.click();
  await expect(page.getByText('Answer sent')).toBeVisible();
  expect(daemon.approvalActions[0]).toMatchObject({
    approvalId: EXEC_PROMPT_APPROVAL.id,
    action: 'approve',
    body: { modifiedArgs: { answer: 'yes' } },
  });
  await expectNoHorizontalScroll(page);
});

test('approval rules live in Settings, Permissions, and delete revokes one', async ({ page }) => {
  await installMockDaemon(page, { permissionRules: [SEEDED_PERMISSION_RULE] });
  await page.goto('/?view=work&settings=permissions');
  const rules = page.locator('[data-testid="permission-rules"]');
  await expect(rules).toContainText('Allow · path · edit');
  await expect(rules).toContainText('edits under src/**');
  await rules.getByRole('button', { name: /Delete rule: Allow · path · edit/ }).click();
  await expect(page.getByText('Rule deleted')).toBeVisible();
  await expect(rules).toContainText('No approval rules yet');
  await expectNoHorizontalScroll(page);
});
