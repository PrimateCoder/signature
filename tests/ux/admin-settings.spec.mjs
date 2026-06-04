// Admin settings spec — tests the extension's admin settings page.

import {
  createBrowser, createPage,
  dbWriteSetting, dbReadSetting, clearCache,
  BASE_URL,
} from '../../.pianotell/tests/ux/helpers.mjs';

const COOKIE = process.env.PIANOTELL_FLARUM_UX_COOKIE;
if (!BASE_URL || !COOKIE) {
  console.error('PIANOTELL_FLARUM_UX_BASE_URL and PIANOTELL_FLARUM_UX_COOKIE must be set.');
  process.exit(2);
}

const failures = [];
function check(label, ok, detail) {
  if (ok) console.log(`  ✓ ${label}`);
  else { console.log(`  ✗ ${label}  ${detail ?? ''}`); failures.push({ label, detail }); }
}

(async () => {
  console.log('admin-settings spec');

  const defaults = {
    maximumImageCount: '2',
    maximumCharLimit: '500',
    allowInlineEditing: '0',
  };

  await clearCache();

  const { browser, context } = await createBrowser(COOKIE);
  const page = await createPage(context);

  const settingsUrl = `${BASE_URL}/admin#/extension/fof-signature`;

  const formGroup = (labelText) => page.locator('.Form-group', { hasText: labelText }).first();
  const settingInput = (labelText, selector) => formGroup(labelText).locator(selector).first();

  async function saveSettings() {
    await page.waitForTimeout(500);

    let saveButton = page.locator('button.Button--primary', { hasText: 'Save' }).first();
    if (await saveButton.count() === 0) {
      saveButton = page.locator('button.Button--primary').first();
    }

    const exists = await saveButton.count();
    if (!exists) return false;

    await saveButton.click();
    await page.waitForTimeout(2000);
    return true;
  }

  try {
    await page.goto(settingsUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('.ExtensionPage', { timeout: 15_000 });
    check('Extension page loads in admin', true);

    const maxImagesInput = settingInput('Maximum inserted images.', 'input[type="number"]');
    const maxCharInput = settingInput('Maximum character limit of signature.', 'input[type="number"]');
    const inlineEditingToggle = settingInput('Inline editing of signature.', 'input[type="checkbox"]');

    check('Maximum image count number input present', await maxImagesInput.count() > 0);
    check('Maximum char limit number input present', await maxCharInput.count() > 0);
    check('Inline editing checkbox/toggle present', await inlineEditingToggle.count() > 0);

    if (await maxCharInput.count() > 0) {
      const newValue = '777';
      await maxCharInput.fill(newValue);
      const saved = await saveSettings();

      if (saved) {
        await page.goto(settingsUrl, { waitUntil: 'networkidle' });
        await page.waitForSelector('.ExtensionPage', { timeout: 15_000 });
        const reloadedValue = await settingInput('Maximum character limit of signature.', 'input[type="number"]').inputValue();
        check('Changing max char limit persists after reload', reloadedValue === newValue,
          `expected "${newValue}", got "${reloadedValue}"`);
      } else {
        check('Changing max char limit persists after reload', false, 'no save button found');
      }
    } else {
      check('Changing max char limit persists after reload', false, 'max char limit input not found');
    }

    const inlineToggleAfterReload = settingInput('Inline editing of signature.', 'input[type="checkbox"]');
    if (await inlineToggleAfterReload.count() > 0) {
      const desiredChecked = true;
      if ((await inlineToggleAfterReload.isChecked()) !== desiredChecked) {
        await inlineToggleAfterReload.click();
      }
      const saved = await saveSettings();

      if (saved) {
        const savedValue = await dbReadSetting('signature.allow_inline_editing');
        check('Changing inline editing persists via dbReadSetting', savedValue === '1',
          `expected "1", got "${savedValue}"`);
      } else {
        check('Changing inline editing persists via dbReadSetting', false, 'no save button found');
      }
    } else {
      check('Changing inline editing persists via dbReadSetting', false, 'inline editing toggle not found');
    }

    const pageText = await page.locator('body').innerText();
    check('Permissions section has "Can have a signature"', pageText.includes('Can have a signature'));
    check('Permissions section has "Edit other users\' signatures"', pageText.includes("Edit other users' signatures"));

    check('No JS errors', page._uxErrors.length === 0,
      page._uxErrors.length > 0 ? page._uxErrors.join('; ') : undefined);
  } finally {
    await dbWriteSetting('signature.maximum_image_count', defaults.maximumImageCount);
    await dbWriteSetting('signature.maximum_char_limit', defaults.maximumCharLimit);
    await dbWriteSetting('signature.allow_inline_editing', defaults.allowInlineEditing);
    await clearCache();
    await browser.close();
  }

  if (failures.length) {
    console.log(`\n${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');
})();
