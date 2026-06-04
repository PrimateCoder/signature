import {
  createBrowser, createPage, createTestDiscussion,
  apiFetch, apiPatchJson,
  dbWriteSetting, clearCache,
  BASE_URL,
} from '../../.pianotell/tests/ux/helpers.mjs';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

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

async function fetchTestUser() {
  const users = await apiFetch(`/users?filter[q]=${encodeURIComponent('pianotell_ux_test')}`, COOKIE);
  const user = users.data?.find((entry) => entry.attributes?.username === 'pianotell_ux_test') || users.data?.[0];

  if (!user) {
    throw new Error('Could not resolve pianotell_ux_test user via API');
  }

  return {
    id: user.id,
    username: user.attributes?.username || 'pianotell_ux_test',
    slug: user.attributes?.slug || user.attributes?.username || 'pianotell_ux_test',
  };
}

async function fetchUserAttributes(userId) {
  const payload = await apiFetch(`/users/${userId}`, COOKIE);
  return payload.data?.attributes || {};
}

async function openSignatureEditor(page, mode = 'button') {
  if (mode === 'button') {
    await page.getByRole('button', { name: 'Edit Signature' }).click();
  } else {
    await page.locator('.Signature-content').click();
  }

  await page.waitForSelector('.SignatureEditor textarea', { timeout: 10_000 });
}

async function saveSignature(page, value) {
  const textarea = page.locator('.SignatureEditor textarea');
  await textarea.fill(value);
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: 'Save Signature' }).click();
  await page.waitForSelector('.Signature-content', { timeout: 10_000 });
  await page.waitForTimeout(1000);
}

(async () => {
  console.log('signature-crud spec');

  await dbWriteSetting('signature.allow_inline_editing', '0');
  await clearCache();

  const { id: userId, username, slug } = await fetchTestUser();
  const signatureUrl = `${BASE_URL}/u/${slug}/signature`;
  const profileUrl = `${BASE_URL}/u/${slug}`;
  const createText = `Created signature ${Date.now()}`;
  const editText = `Edited signature ${Date.now() + 1}`;

  await apiPatchJson(`/users/${userId}`, {
    data: { attributes: { signature: '' } },
  }, COOKIE);

  const { browser, context } = await createBrowser(COOKIE);
  const page = await createPage(context);

  try {
    await page.goto(signatureUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('.SignaturePage', { timeout: 15_000 });
    check('Signature page accessible', (await page.$('.SignaturePage')) !== null, `url=${page.url()}`);

    // FoF design: self-editing lives on the Settings page, not a profile tab.
    await page.goto(`${BASE_URL}/settings`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.SettingsPage', { timeout: 15_000 });
    check('Settings page has Signature section', (await page.$('.Settings-signature')) !== null);

    await page.goto(signatureUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('.SignaturePage', { timeout: 15_000 });
    check('Edit Signature button visible', await page.getByRole('button', { name: 'Edit Signature' }).isVisible());
    check('Empty signature prompt shown', (await page.locator('.Signature-content').textContent())?.includes('Click to write your signature'));

    await openSignatureEditor(page, 'button');
    await saveSignature(page, createText);
    const createdText = await page.locator('.Signature-content').textContent();
    check('Create signature renders', createdText?.includes(createText), `text=${JSON.stringify(createdText)}`);

    const createdAttrs = await fetchUserAttributes(userId);
    check('Create signature persists via API', createdAttrs.signature === createText,
      `expected ${JSON.stringify(createText)}, got ${JSON.stringify(createdAttrs.signature)}`);

    const discussionId = await createTestDiscussion(
      `Signature CRUD ${Date.now()}`,
      'Signature discussion body.',
      [],
      COOKIE
    );

    await page.goto(`${BASE_URL}/d/${discussionId}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.PostStream', { timeout: 15_000 });
    await page.waitForTimeout(1000);
    const postSignatureText = await page.locator('.Post-signature .Signature-content').first().textContent().catch(() => null);
    check('Signature displays under posts', !!postSignatureText && postSignatureText.includes(createText),
      `text=${JSON.stringify(postSignatureText)}`);

    await page.goto(signatureUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('.SignaturePage', { timeout: 15_000 });
    await openSignatureEditor(page, 'content');
    check('Clicking signature content opens editor', (await page.$('.SignatureEditor textarea')) !== null);
    await saveSignature(page, editText);
    const editedText = await page.locator('.Signature-content').textContent();
    check('Edit signature updates rendered content', editedText?.includes(editText), `text=${JSON.stringify(editedText)}`);

    const editedAttrs = await fetchUserAttributes(userId);
    check('Edit signature persists via API', editedAttrs.signature === editText,
      `expected ${JSON.stringify(editText)}, got ${JSON.stringify(editedAttrs.signature)}`);

    await page.goto(`${BASE_URL}/d/${discussionId}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.PostStream', { timeout: 15_000 });
    await page.waitForTimeout(1000);
    const editedPostSignatureText = await page.locator('.Post-signature .Signature-content').first().textContent().catch(() => null);
    check('Edited signature updates under posts', !!editedPostSignatureText && editedPostSignatureText.includes(editText),
      `text=${JSON.stringify(editedPostSignatureText)}`);

    await page.goto(signatureUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('.SignaturePage', { timeout: 15_000 });
    await openSignatureEditor(page, 'button');
    await saveSignature(page, '');
    const clearedText = await page.locator('.Signature-content').textContent();
    check('Clear signature restores empty prompt', clearedText?.includes('Click to write your signature'),
      `text=${JSON.stringify(clearedText)}`);

    const clearedAttrs = await fetchUserAttributes(userId);
    check('Clear signature persists via API', clearedAttrs.signature == null,
      `expected null, got ${JSON.stringify(clearedAttrs.signature)}`);

    await page.goto(`${BASE_URL}/d/${discussionId}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.PostStream', { timeout: 15_000 });
    await page.waitForTimeout(1000);
    check('Cleared signature removed from posts', (await page.$('.Post-signature')) === null);

    check('No JS errors', page._uxErrors.length === 0,
      page._uxErrors.length > 0 ? page._uxErrors.join('; ') : undefined);
  } finally {
    await apiPatchJson(`/users/${userId}`, {
      data: { attributes: { signature: '' } },
    }, COOKIE);
    await browser.close();
  }

  if (failures.length) {
    console.log(`\n${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');
})();
