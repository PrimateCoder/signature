// Visual baseline spec — pixel-level regression tests for FoF signature UI elements.
//
// Captures and compares screenshots for each visual state:
//   1. Signature under a post (with FoF accent bar styling)
//   2. Signature page with content (moderator-only profile tab)
//   3. Signature editor open (on signature page)
//   4. Admin settings page
//   5. Empty signature state (signature page)
//   6. Settings page signature section (FoF self-editing UI)
//
// Set BASELINE_UPDATE=1 to accept new baselines.
// Baselines are committed in tests/ux/_baselines/.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  createBrowser, createPage, createTestDiscussion,
  dbWriteSetting, clearCache, apiPatchJson,
  compareScreenshot, fetchTestUser,
  BASE_URL,
} from '../../.pianotell/tests/ux/helpers.mjs';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINES = resolve(HERE, '_baselines');
const COOKIE = process.env.PIANOTELL_FLARUM_UX_COOKIE;
const UPDATE = process.env.BASELINE_UPDATE === '1';

if (!BASE_URL || !COOKIE) {
  console.error('PIANOTELL_FLARUM_UX_BASE_URL and PIANOTELL_FLARUM_UX_COOKIE must be set.');
  process.exit(2);
}

const failures = [];
function check(label, ok, detail) {
  if (ok) console.log(`  ✓ ${label}${detail ? '  ' + detail : ''}`);
  else { console.log(`  ✗ ${label}  ${detail ?? ''}`); failures.push({ label, detail }); }
}

async function screenshotElement(page, selector) {
  const el = await page.$(selector);
  if (!el) return null;
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const box = await el.boundingBox();
  if (!box) return null;
  const pad = 4;
  return {
    x: Math.max(0, Math.round(box.x - pad)),
    y: Math.max(0, Math.round(box.y - pad)),
    width: Math.round(box.width + pad * 2),
    height: Math.round(box.height + pad * 2),
  };
}

(async () => {
  console.log('visual-baseline spec');

  await dbWriteSetting('signature.allow_inline_editing', '0');
  await clearCache();

  const { id: userId, slug } = await fetchTestUser();
  const signatureUrl = `${BASE_URL}/u/${slug}/signature`;
  const settingsUrl = `${BASE_URL}/settings`;
  const signatureText = 'Test signature for visual baseline';

  await apiPatchJson(`/users/${userId}`, {
    data: { attributes: { signature: signatureText } },
  }, COOKIE);

  const discussionId = await createTestDiscussion(
    'Signature Visual Baseline ' + Date.now(),
    'Post for visual baseline.',
    [],
    COOKIE
  );

  const { browser, context } = await createBrowser(COOKIE);
  const page = await createPage(context);

  try {
    // 1. Signature under a post (FoF wraps in .Post-signature with accent bar)
    await page.goto(`${BASE_URL}/d/${discussionId}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.PostStream', { timeout: 15_000 });
    await page.waitForSelector('.Post-signature', { timeout: 10_000 });
    await page.waitForTimeout(1000);

    let clip = await screenshotElement(page, '.Post-signature');
    if (clip) {
      const r = await compareScreenshot(page, {
        baselinePath: resolve(BASELINES, 'post-signature.png'),
        clip, update: UPDATE, maxDiffPixels: 100,
      });
      check('Signature under a post', r.pass, r.detail);
    } else {
      check('Signature under a post', false, 'element not found');
    }

    // 2. Signature page with content (admin sees this as moderator tab)
    await page.goto(signatureUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('.SignaturePage', { timeout: 15_000 });
    await page.waitForSelector('.Signature-content', { timeout: 10_000 });
    await page.waitForTimeout(500);

    clip = await screenshotElement(page, '.SignaturePage');
    if (clip) {
      const r = await compareScreenshot(page, {
        baselinePath: resolve(BASELINES, 'signature-page-content.png'),
        clip, update: UPDATE, maxDiffPixels: 200,
      });
      check('Signature page with content', r.pass, r.detail);
    } else {
      check('Signature page with content', false, 'element not found');
    }

    // 3. Signature editor open (via Edit button on signature page)
    await page.getByRole('button', { name: 'Edit Signature' }).click();
    await page.waitForSelector('.SignatureEditor', { timeout: 10_000 });
    await page.waitForTimeout(500);

    clip = await screenshotElement(page, '.SignatureEditor');
    if (clip) {
      const r = await compareScreenshot(page, {
        baselinePath: resolve(BASELINES, 'signature-editor-open.png'),
        clip, update: UPDATE, maxDiffPixels: 200,
      });
      check('Signature editor open', r.pass, r.detail);
    } else {
      check('Signature editor open', false, 'element not found');
    }

    // 4. Admin settings page
    await page.goto(`${BASE_URL}/admin#/extension/fof-signature`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.ExtensionPage', { timeout: 15_000 });
    await page.waitForTimeout(500);

    clip = await screenshotElement(page, '.ExtensionPage-settings');
    if (!clip) {
      clip = await screenshotElement(page, '.ExtensionPage-body');
    }
    if (clip) {
      const r = await compareScreenshot(page, {
        baselinePath: resolve(BASELINES, 'admin-settings.png'),
        clip, update: UPDATE, maxDiffPixels: 200,
      });
      check('Admin settings page', r.pass, r.detail);
    } else {
      check('Admin settings page', false, 'settings container not found');
    }

    // 5. Empty signature state (signature page)
    await apiPatchJson(`/users/${userId}`, {
      data: { attributes: { signature: '' } },
    }, COOKIE);
    await page.goto(signatureUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('.SignaturePage', { timeout: 15_000 });
    await page.waitForSelector('.Signature-content', { timeout: 10_000 });
    await page.waitForTimeout(500);

    const emptyText = await page.locator('.Signature-content').textContent();
    check('Empty signature placeholder shown', emptyText?.includes('Click to write your signature'));

    clip = await screenshotElement(page, '.SignaturePage');
    if (clip) {
      const r = await compareScreenshot(page, {
        baselinePath: resolve(BASELINES, 'signature-page-empty.png'),
        clip, update: UPDATE, maxDiffPixels: 200,
      });
      check('Empty signature state', r.pass, r.detail);
    } else {
      check('Empty signature state', false, 'element not found');
    }

    // 6. Settings page signature section (FoF self-editing UI)
    await apiPatchJson(`/users/${userId}`, {
      data: { attributes: { signature: signatureText } },
    }, COOKIE);
    await page.goto(settingsUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('.Settings-signature', { timeout: 15_000 });
    await page.waitForTimeout(500);

    clip = await screenshotElement(page, '.Settings-signature');
    if (clip) {
      const r = await compareScreenshot(page, {
        baselinePath: resolve(BASELINES, 'settings-signature.png'),
        clip, update: UPDATE, maxDiffPixels: 200,
      });
      check('Settings page signature section', r.pass, r.detail);
    } else {
      check('Settings page signature section', false, 'element not found');
    }

    // 7. No JS errors
    check('No JS errors', page._uxErrors.length === 0,
      page._uxErrors.length > 0 ? page._uxErrors.join('; ') : undefined);
  } finally {
    await apiPatchJson(`/users/${userId}`, {
      data: { attributes: { signature: '' } },
    }, COOKIE);
    await clearCache();
    await browser.close();
  }

  if (failures.length) {
    console.log(`\n${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');
})();
