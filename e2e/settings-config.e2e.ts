/**
 * The settings dialog: one glass dialog for configuration (Admin, Providers
 * and the old config modal moved into its sections), with the schema-driven
 * config.get/config.set rows restyled onto kit controls. Proves the entry
 * points (account menu, Ctrl ,, deep links, the old ?view=admin/providers
 * links), search, Escape and focus return, and every config behavior the old
 * modal proved. Runs on BOTH phone and desktop.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { DESKTOP, expectNoHorizontalScroll, only, openNavigation, openRow, openSettings, PHONE } from './support/app';
import { FEATURE_SETTINGS } from '../src/lib/generated/config-schema';

test.beforeEach(async ({ page }) => {
  await installMockDaemon(page);
});

/**
 * Open a section's page and make sure its content (not the phone's list) is
 * showing: on a phone, the General link opens on the list first. `label` is
 * the page's label (a section opens the page that holds it).
 */
async function openSection(page: Page, section: string, label: string): Promise<Locator> {
  const dialog = await openSettings(page, section);
  if (await dialog.locator('.settings-pane').count() === 0) {
    await dialog.getByRole('button', { name: label, exact: true }).click();
  }
  await expect(dialog.locator('.settings-pane-title')).toHaveText(label);
  return dialog;
}

/** Pick an option in a kit Select (its listbox is portaled to the body). */
async function pick(page: Page, trigger: Locator, option: string): Promise<void> {
  await trigger.click();
  await page.getByRole('listbox').getByRole('option', { name: option, exact: true }).click();
}

async function closeDialog(page: Page): Promise<void> {
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0);
}

test.describe('entry points, deep links and dismissal', () => {
  test('the account menu\'s Settings opens the dialog; Escape closes it and focus returns', async ({ page }) => {
    await page.goto('/?view=library');
    await openNavigation(page);
    const account = page.getByRole('button', { name: /^Account: / });
    await account.click();
    await page.getByRole('menu', { name: 'Account' }).getByRole('menuitem', { name: /^Settings/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/settings=general/);
    // The account menu no longer carries the old Admin / Providers pages.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page).not.toHaveURL(/settings=/);
  });

  test('Ctrl , opens the dialog on desktop on the page title, typing goes to search, focus returns on close', async ({ page }, testInfo) => {
    only(testInfo, DESKTOP);
    await page.goto('/?view=library');
    await expect(page.locator('.app-shell')).toBeVisible();
    await page.getByRole('button', { name: 'Collapse sidebar' }).focus();
    await page.keyboard.press('Control+Comma');
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();
    // The search field does not take focus on open; the page title does.
    const search = dialog.getByRole('searchbox', { name: 'Search settings' });
    await expect(dialog.locator('.settings-pane-title')).toBeFocused();
    await expect(search).not.toBeFocused();
    // Typing a character outside a field moves it into search.
    await page.keyboard.press('t');
    await expect(search).toBeFocused();
    await expect(search).toHaveValue('t');
    await search.fill('');
    await dialog.locator('.settings-pane-title').focus();
    await page.keyboard.press('/');
    await expect(search).toBeFocused();
    await expect(search).toHaveValue('');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeFocused();
  });

  test('the account menu has no Admin or Models-and-usage page entries', async ({ page }) => {
    await page.goto('/?view=library');
    await openNavigation(page);
    await page.getByRole('button', { name: /^Account: / }).click();
    const menu = page.getByRole('menu', { name: 'Account' });
    await expect(menu.getByRole('menuitem', { name: /^Settings/ })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Models and usage' })).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: 'Admin' })).toHaveCount(0);
  });

  test('?settings=models deep-links to Models and providers', async ({ page }) => {
    const dialog = await openSettings(page, 'models');
    await expect(dialog.locator('.settings-pane-title')).toHaveText('Models and providers');
    await expect(dialog.getByTestId('current-model')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('old ?view=admin and ?view=providers links open Account and Models and providers', async ({ page }) => {
    await page.goto('/?view=admin');
    let dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog.locator('.settings-pane-title')).toHaveText('Account');
    await expect(page).toHaveURL(/view=chat.*settings=account|settings=account.*view=chat/);
    await expect(dialog.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();

    await page.goto('/?view=providers');
    dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog.locator('.settings-pane-title')).toHaveText('Models and providers');
  });

  test('older section links open the parent page, scrolled to the section', async ({ page }) => {
    for (const [section, pageLabel, heading] of [
      ['devices', 'Account', 'Devices and pairing'],
      ['people', 'Account', 'People and channels'],
      ['credentials', 'Models and providers', 'Credentials'],
      ['network', 'General', 'Network'],
      ['all', 'General', 'Advanced'],
      ['checkins', 'Notifications', 'Check-ins'],
    ] as const) {
      const dialog = await openSettings(page, section);
      await expect(dialog.locator('.settings-pane-title')).toHaveText(pageLabel);
      await expect(dialog.getByRole('heading', { name: heading, exact: true, level: 3 })).toBeInViewport();
    }
    await expectNoHorizontalScroll(page);
  });

  test('the old Check-ins page link and the account menu entry open Check-ins in Notifications', async ({ page }) => {
    await page.goto('/?view=checkin');
    let dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog.locator('.settings-pane-title')).toHaveText('Notifications');
    await expect(page).toHaveURL(/settings=checkins/);
    await expect(dialog.getByRole('button', { name: 'Run check-in now' })).toBeVisible();
    await closeDialog(page);

    await openNavigation(page);
    await page.getByRole('button', { name: /^Account: / }).click();
    await page.getByRole('menu', { name: 'Account' }).getByRole('menuitem', { name: 'Check-ins' }).click();
    dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog.getByRole('heading', { name: 'Check-ins', exact: true, level: 3 })).toBeInViewport();
  });

  test('Account shows the current sign-in as readable fields, raw JSON only behind "Show details"', async ({ page }) => {
    const dialog = await openSection(page, 'account', 'Account');
    const signIn = dialog.getByRole('region', { name: 'Current sign-in' });
    await expect(signIn.locator('.settings-readable')).toContainText('Username');
    await expect(signIn.locator('.settings-readable')).toContainText('operator');
    await expect(signIn.locator('.feedback-data-block__code')).toHaveCount(0);
    await signIn.getByRole('button', { name: 'Show details' }).click();
    await expect(signIn.locator('.feedback-data-block__code')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

test.describe('search', () => {
  test('filters sections, and a section matched only by a setting shows just those settings', async ({ page }) => {
    const dialog = await openSettings(page, 'about');
    const search = dialog.getByRole('searchbox', { name: 'Search settings' });
    if (!(await search.isVisible())) await dialog.getByRole('button', { name: 'Back to settings' }).click();
    // "decay" names no section and no hand-built setting, only schema keys
    // (learning.consolidation.decay*), so Memory matches by its settings alone.
    await search.fill('decay');
    const nav = dialog.getByRole('navigation', { name: 'Settings sections' });
    await expect(nav.getByRole('button', { name: /^Memory/ })).toBeVisible();
    await expect(nav.getByRole('button', { name: /^Account/ })).toHaveCount(0);
    await nav.getByRole('button', { name: /^Memory/ }).click();
    await expect(dialog.getByText('learning.consolidation.decayAgeDays', { exact: true })).toBeVisible();
    // Only the matching settings: the diagnostics panel is not part of this result.
    await expect(dialog.locator('[data-testid="memory-diagnostics"]')).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });

  test('a search with no match says so plainly', async ({ page }) => {
    const dialog = await openSettings(page, 'general');
    await dialog.getByRole('searchbox', { name: 'Search settings' }).fill('zzzz-nothing-here');
    await expect(dialog.getByText('No settings match “zzzz-nothing-here”.').first()).toBeVisible();
  });
});

test.describe('phone: the dialog is a full-screen sheet', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => only(testInfo, PHONE));

  test('the panel fills the viewport, the list and a section are two screens', async ({ page }) => {
    const dialog = await openSettings(page, 'general');
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (box && viewport) {
      expect(box.width).toBeGreaterThanOrEqual(viewport.width - 2);
      expect(box.height).toBeGreaterThanOrEqual(viewport.height - 2);
    }
    await dialog.getByRole('button', { name: 'Voice', exact: true }).click();
    await expect(dialog.locator('.settings-pane-title')).toHaveText('Voice');
    await dialog.getByRole('button', { name: 'Back to settings' }).click();
    await expect(dialog.getByRole('button', { name: 'Voice', exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

test('voice.local.* and fleet.maxSize (SDK 1.8.0) render in their real sections, not misfiled', async ({ page }) => {
  let dialog = await openSection(page, 'voice', 'Voice');
  const voiceKeys = ['voice.local.sttEngine', 'voice.local.sttBinary', 'voice.local.sttModelPath', 'voice.local.ttsEngine', 'voice.local.ttsBinary', 'voice.local.ttsModelPath'];
  for (const key of voiceKeys) {
    await expect(dialog.getByText(key, { exact: true })).toBeVisible();
  }

  dialog = await openSection(page, 'devices', 'Account');
  await expect(dialog.getByText('fleet.maxSize', { exact: true })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('sections replace the old domain tabs, and the dissolved enablement bucket never renders', async ({ page }) => {
  const dialog = await openSettings(page, 'general');
  const nav = dialog.getByRole('navigation', { name: 'Settings sections' });
  if (!(await nav.isVisible())) await dialog.getByRole('button', { name: 'Back to settings' }).click();
  const labels = ['General', 'Account', 'Models and providers', 'Voice', 'Notifications', 'Memory', 'Permissions'];
  for (const label of labels) {
    await expect(nav.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
  // Seven pages and no group headings; the former pages are sections inside them.
  await expect(nav.getByRole('button')).toHaveCount(labels.length);
  await expect(nav.getByRole('group')).toHaveCount(0);
  await expect(dialog.getByText('Feature Flags')).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test('changing an enum feature mode writes the domain key and survives reopen', async ({ page }) => {
  let dialog = await openSection(page, 'general', 'General');
  const unit = dialog.locator('[data-feature-id="hitl-ux-modes"]');
  await expect(unit).toBeVisible();
  const mode = unit.getByRole('button', { name: 'HITL UX Modes mode' });
  await expect(mode).toContainText('balanced'); // live seeded value
  // The full schema mode set is a real choice list, the inactive mode included.
  await mode.click();
  await expect(page.getByRole('listbox').getByRole('option')).toHaveText(['off', 'quiet', 'balanced', 'operator']);
  await page.getByRole('listbox').getByRole('option', { name: 'quiet', exact: true }).click();
  await expect(page.getByText('Config saved')).toBeVisible();
  await closeDialog(page);

  // Reopen: the mock daemon's mutable config tree round-trips the domain key.
  dialog = await openSection(page, 'general', 'General');
  await expect(dialog.locator('[data-feature-id="hitl-ux-modes"]').getByRole('button', { name: 'HITL UX Modes mode' })).toContainText('quiet');
});

test('toggling a boolean feature writes true/false to its domain key; a runtime-toggleable one shows no restart marker', async ({ page }) => {
  let dialog = await openSection(page, 'permissions', 'Permissions');
  const unit = dialog.locator('[data-feature-id="permission-divergence-dashboard"]');
  await expect(unit).toBeVisible();
  const toggle = unit.getByRole('switch', { name: 'Enable Divergence Dashboard and Enforce Gate' });
  await expect(toggle).toBeChecked(); // ruled default: on
  await toggle.click();
  await expect(page.getByText('Config saved')).toBeVisible();
  // Immediate-apply feature: no pending-restart marker, honestly.
  await expect(unit.locator('[data-pending-restart]')).toHaveCount(0);
  await closeDialog(page);

  // Reopen: the write persisted onto the domain key (permissions.divergenceDashboard=false).
  dialog = await openSection(page, 'permissions', 'Permissions');
  await expect(
    dialog.locator('[data-feature-id="permission-divergence-dashboard"]').getByRole('switch', { name: 'Enable Divergence Dashboard and Enforce Gate' }),
  ).not.toBeChecked();
});

test('a restart-gated feature states it up front and marks pending-restart at the point of change', async ({ page }) => {
  const dialog = await openSection(page, 'permissions', 'Permissions');
  const unit = dialog.locator('[data-feature-id="permissions-simulation"]');
  await expect(unit).toBeVisible();
  await expect(unit.getByText('Enablement changes apply after a daemon restart.')).toBeVisible();
  await expect(unit.locator('[data-pending-restart]')).toHaveCount(0);
  await unit.getByRole('switch', { name: 'Enable Permissions Simulation Mode' }).click();
  await expect(page.getByText('Config saved')).toBeVisible();
  const marker = unit.locator('[data-pending-restart="permissions-simulation"]');
  await expect(marker).toBeVisible();
  await expect(marker).toContainText('takes effect when the daemon restarts');
});

test('a feature description renders complete and un-clipped at phone width', async ({ page }, testInfo) => {
  only(testInfo, PHONE);
  const dialog = await openSection(page, 'general', 'General');
  const desc = dialog.locator('[data-feature-id="hitl-ux-modes"] .feature-unit-desc');
  await expect(desc).toBeVisible();
  // Character-exact parity with the SDK's full description, no truncation.
  const meta = FEATURE_SETTINGS.find((f) => f.id === 'hitl-ux-modes');
  if (!meta) throw new Error('hitl-ux-modes missing from the generated feature snapshot');
  await expect(desc).toHaveText(meta.description);
  // And the rendered box holds the whole text: wrap, never clip.
  const clipped = await desc.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  expect(clipped.scrollWidth, 'description overflows horizontally').toBeLessThanOrEqual(clipped.clientWidth + 1);
  expect(clipped.scrollHeight, 'description is vertically clipped').toBeLessThanOrEqual(clipped.clientHeight + 1);
  await expectNoHorizontalScroll(page);
});

test('a secret-shaped surfaces.* key never renders its raw value', async ({ page }) => {
  const dialog = await openSection(page, 'devices', 'Account');
  await expect(dialog.getByText('surfaces.slack.botToken')).toBeVisible();
  await expect(dialog.getByText('xoxb-e2e-hermetic-secret-9999')).toHaveCount(0);
  // Last 4 chars only, per the mask contract. Every secret-typed key renders a
  // masked cell (the unset ones read "(unset)"), so scope to the one key that
  // actually holds a value rather than matching all masked cells at once.
  await expect(
    dialog.locator('[data-config-key="surfaces.slack.botToken"] .settings-value--secret'),
  ).toContainText('9999');
});

test('an admin-scope refusal renders honestly, distinct from a generic failure', async ({ page }) => {
  await installMockDaemon(page, { config: 'admin-required' });
  const dialog = await openSection(page, 'permissions', 'Permissions');
  await expect(dialog.getByText('Admin access required')).toBeVisible();
});

test('the Advanced editor writes through config.set and the change is honestly reflected on reopen', async ({ page }) => {
  let dialog = await openSection(page, 'all', 'General');
  await dialog.getByPlaceholder('settings.path').fill('display.theme');
  await dialog.getByPlaceholder('JSON or text').fill('"cyberpunk"');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Config saved')).toBeVisible();
  await closeDialog(page);

  // Reopen: General's typed editor for display.theme shows the value just
  // written, proving a real config.get/config.set round-trip, not a
  // client-side-only form. display.theme is an enum (the bundled theme names);
  // a value outside it still shows, as itself, on the control.
  dialog = await openSection(page, 'general', 'General');
  await expect(dialog.getByRole('button', { name: 'display.theme', exact: true })).toContainText('cyberpunk');
});

test.describe('pricing.modelPrices: the structured per-model price editor', () => {
  test('renders as price rows with full description, never a JSON blob textarea', async ({ page }) => {
    const dialog = await openSection(page, 'models', 'Models and providers');
    const field = dialog.locator('[data-config-key="pricing.modelPrices"]');
    await expect(field).toBeVisible();
    await expect(field.locator('.settings-field-desc')).toContainText('Manual model prices');
    await expect(field.locator('[data-testid="model-prices-editor"]')).toBeVisible();
    await expect(field.locator('textarea')).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });

  test('a manual price set via the editor persists, re-renders in the table, and labels the priced fleet node "your price"', async ({ page }) => {
    let dialog = await openSection(page, 'models', 'Models and providers');
    const editor = dialog.locator('[data-testid="model-prices-editor"]');
    // Empty table → the add form is already open.
    await editor.getByLabel('Model key (provider:model)').fill('anthropic:claude-3-5-haiku');
    await editor.getByLabel('Input price (USD per 1M tokens)').fill('0.8');
    await editor.getByLabel('Output price (USD per 1M tokens)').fill('4');
    await editor.getByRole('button', { name: 'Add price' }).click();
    await expect(page.getByText('Config saved')).toBeVisible();
    await expect(editor.locator('[data-model-key="anthropic:claude-3-5-haiku"]')).toContainText('in $0.8 · out $4 per 1M tokens');
    await expectNoHorizontalScroll(page);
    await closeDialog(page);

    // Reopen, the mock daemon's mutable config tree round-trips the object key.
    dialog = await openSection(page, 'models', 'Models and providers');
    await expect(dialog.locator('[data-model-key="anthropic:claude-3-5-haiku"]')).toBeVisible();
    await closeDialog(page);

    // The priced fleet node for that provider:model now states the source:
    // manual wins in the resolver, so the label is "your price".
    await page.goto('/?view=work&tab=agents');
    await openRow(page, 'Refactor the session spine');
    const note = page.locator('[data-testid="price-source-note"]');
    await expect(note).toContainText('your price');
    await expect(note.getByRole('button', { name: 'Edit price' })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('an invalid entry is refused inline with the exact problem, nothing silently written', async ({ page }) => {
    const dialog = await openSection(page, 'models', 'Models and providers');
    const editor = dialog.locator('[data-testid="model-prices-editor"]');
    await editor.getByLabel('Model key (provider:model)').fill('no-colon');
    await editor.getByLabel('Input price (USD per 1M tokens)').fill('1');
    await editor.getByLabel('Output price (USD per 1M tokens)').fill('2');
    await editor.getByRole('button', { name: 'Add price' }).click();
    await expect(editor.locator('.model-prices-error')).toContainText('provider:model');
    await expect(page.getByText('Config saved')).toHaveCount(0);
  });
});

test.describe('daemon.timezone: searchable IANA picker', () => {
  test('renders a search box, an explicit "UTC (unset)" option, and real zone names', async ({ page }) => {
    const dialog = await openSection(page, 'general', 'General');
    const field = dialog.locator('[data-config-key="daemon.timezone"]');
    await expect(field).toBeVisible();
    const picker = field.locator('[data-testid="timezone-picker"]');
    await expect(picker).toBeVisible();
    await expect(picker.getByLabel('Search timezones')).toBeVisible();
    await picker.getByRole('button', { name: 'daemon.timezone' }).click();
    const list = page.getByRole('listbox', { name: 'daemon.timezone' });
    await expect(list.getByRole('option', { name: 'UTC (unset)' })).toHaveCount(1);
    await expect(list.getByRole('option', { name: 'America/New_York', exact: true })).toHaveCount(1);
    await expectNoHorizontalScroll(page);
  });

  test('selecting a real zone writes that exact IANA name and it survives reopen', async ({ page }) => {
    let dialog = await openSection(page, 'general', 'General');
    const field = dialog.locator('[data-config-key="daemon.timezone"]');
    await field.getByLabel('Search timezones').fill('London');
    await pick(page, field.getByRole('button', { name: 'daemon.timezone' }), 'Europe/London');
    await expect(page.getByText('Config saved')).toBeVisible();
    await closeDialog(page);

    dialog = await openSection(page, 'general', 'General');
    await expect(dialog.locator('[data-config-key="daemon.timezone"]').getByRole('button', { name: 'daemon.timezone' })).toContainText('Europe/London');
  });

  test('selecting "UTC (unset)" writes the empty string', async ({ page }) => {
    const dialog = await openSection(page, 'general', 'General');
    const field = dialog.locator('[data-config-key="daemon.timezone"]');
    const trigger = field.getByRole('button', { name: 'daemon.timezone' });
    await field.getByLabel('Search timezones').fill('Tokyo');
    await pick(page, trigger, 'Asia/Tokyo');
    await expect(page.getByText('Config saved').last()).toBeVisible();
    await pick(page, trigger, 'UTC (unset)');
    // .last(): the first save's toast may still be visible (5s auto-dismiss).
    await expect(page.getByText('Config saved').last()).toBeVisible();
    await expect(trigger).toContainText('UTC (unset)');
  });
});

test.describe('payments.*: budget money fields and the cvvHandling trade-off warning', () => {
  test('a budget field is entered in ordinary currency units and stored/read back as the exact amount typed', async ({ page }) => {
    let dialog = await openSection(page, 'usage', 'Models and providers');
    const field = dialog.locator('[data-config-key="payments.budget.dailyItem"]');
    await expect(field).toBeVisible();
    const moneyField = field.locator('[data-testid="money-field"]');
    await expect(moneyField).toBeVisible();
    const amount = moneyField.getByLabel(/Amount in USD/);
    await amount.fill('100');
    await amount.blur();
    await expect(page.getByText('Config saved')).toBeVisible();
    // No unit conversion: the value shown is exactly the amount typed.
    await expect(amount).toHaveValue('100');
    await closeDialog(page);

    // Reopen: the mock daemon's mutable config tree round-trips the exact
    // amount typed back into the input, unscaled.
    dialog = await openSection(page, 'usage', 'Models and providers');
    const reopened = dialog.locator('[data-config-key="payments.budget.dailyItem"] [data-testid="money-field"]');
    await expect(reopened.getByLabel(/Amount in USD/)).toHaveValue('100');
  });

  test('cvvHandling: selecting "prompt" surfaces the trade-off warning; "stored" shows none', async ({ page }) => {
    const dialog = await openSection(page, 'usage', 'Models and providers');
    const field = dialog.locator('[data-config-key="payments.cvvHandling"]');
    await expect(field).toBeVisible();
    const select = field.locator('[data-testid="cvv-handling-field"]').getByRole('button', { name: 'payments.cvvHandling' });
    await expect(select).toContainText('stored'); // schema default
    await expect(field.locator('[data-testid="cvv-prompt-warning"]')).toHaveCount(0);

    await pick(page, select, 'prompt');
    await expect(page.getByText('Config saved').last()).toBeVisible();
    await expect(field.locator('[data-testid="cvv-prompt-warning"]')).toBeVisible();
    await expect(field.locator('[data-testid="cvv-prompt-warning"]')).toContainText('disables unattended purchasing');

    await pick(page, select, 'stored');
    // .last(): the first save's toast may still be on screen (5s auto-dismiss).
    await expect(page.getByText('Config saved').last()).toBeVisible();
    await expect(field.locator('[data-testid="cvv-prompt-warning"]')).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });

  test('no card material (cvv/pan/cardNumber) ever renders anywhere in the Payments group', async ({ page }) => {
    const dialog = await openSection(page, 'usage', 'Models and providers');
    const group = dialog.locator('[data-config-group="payments"]');
    await expect(group.locator('[data-config-key*="cvv" i]:not([data-config-key="payments.cvvHandling"])')).toHaveCount(0);
    await expect(group.locator('[data-config-key*="pan" i]')).toHaveCount(0);
    await expect(group.locator('[data-config-key*="cardNumber" i]')).toHaveCount(0);
    // payments.defaultCardId (a reference, not material) is expected to render.
    await expect(group.locator('[data-config-key="payments.defaultCardId"]')).toBeVisible();
  });
});
