import {
  createBrowser, createPage,
  dbWriteSetting, dbReadSetting, clearCache, apiFetch, dbQuery,
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

async function patchSignature(userId, signature, token) {
  const resp = await fetch(`${BASE_URL}/api/users/${userId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': 'Token ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: { attributes: { signature } },
    }),
  });

  const text = await resp.text();
  let body = {};

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }

  return { status: resp.status, body };
}

async function fetchAdminUser() {
  const result = await apiFetch('/users?filter[q]=pianotell_ux_test', COOKIE);
  const user = result?.data?.find((entry) => entry?.attributes?.username === 'pianotell_ux_test') || result?.data?.[0];

  if (!user?.id) {
    throw new Error(`Unable to find admin test user: ${JSON.stringify(result)}`);
  }

  return user;
}

async function readUser(userId) {
  return apiFetch(`/users/${userId}`, COOKIE);
}

function summarizeResponse(resp) {
  return JSON.stringify({ status: resp.status, body: resp.body });
}

function hex(value) {
  return Buffer.from(String(value), 'utf8').toString('hex').toUpperCase();
}

async function ensureSettingRow(key, value) {
  await dbQuery(
    `INSERT INTO settings (\`key\`, \`value\`) VALUES (UNHEX('${hex(key)}'), UNHEX('${hex(value)}')) ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`)`
  );
}

(async () => {
  console.log('validation spec');

  let browser;
  let userId;

  try {
    await ensureSettingRow('signature.maximum_char_limit', '500');
    await ensureSettingRow('signature.maximum_image_count', '2');

    const adminUser = await fetchAdminUser();
    userId = adminUser.id;

    await dbWriteSetting('signature.maximum_char_limit', '10');
    await clearCache();
    const limitAtTen = await dbReadSetting('signature.maximum_char_limit');
    check(
      'signature.maximum_char_limit set to 10',
      limitAtTen === '10',
      `current value: ${limitAtTen}`,
    );

    let resp = await patchSignature(userId, '1234567890', COOKIE);
    check(
      'Signature at exact char limit accepted',
      resp.status === 200,
      summarizeResponse(resp),
    );

    resp = await patchSignature(userId, '12345678901', COOKIE);
    check(
      'Signature over char limit rejected',
      resp.status === 422 && Array.isArray(resp.body?.errors) && resp.body.errors.length > 0,
      summarizeResponse(resp),
    );

    resp = await patchSignature(userId, 'abcdefghij', COOKIE);
    check(
      'Signature at exact char limit accepted (boundary)',
      resp.status === 200,
      summarizeResponse(resp),
    );

    await dbWriteSetting('signature.maximum_char_limit', '500');
    await clearCache();
    const limitAtFiveHundred = await dbReadSetting('signature.maximum_char_limit');
    check(
      'signature.maximum_char_limit restored to 500',
      limitAtFiveHundred === '500',
      `current value: ${limitAtFiveHundred}`,
    );

    resp = await patchSignature(userId, 'Normal signature', COOKIE);
    check(
      'Valid signature accepted after restoring default limit',
      resp.status === 200,
      summarizeResponse(resp),
    );

    resp = await patchSignature(userId, '   ', COOKIE);
    const clearedUser = await readUser(userId);
    check(
      'Empty/whitespace signature clears value',
      resp.status === 200 && clearedUser?.data?.attributes?.signature == null,
      JSON.stringify({ patch: summarizeResponse(resp), readback: clearedUser?.data?.attributes?.signature }),
    );

    const unicodeSignature = 'Hello 🎹 Wörld';
    resp = await patchSignature(userId, unicodeSignature, COOKIE);
    const unicodeUser = await readUser(userId);
    check(
      'Unicode signature preserved',
      resp.status === 200 && unicodeUser?.data?.attributes?.signature === unicodeSignature,
      JSON.stringify({ patch: summarizeResponse(resp), readback: unicodeUser?.data?.attributes?.signature }),
    );

    const browserSetup = await createBrowser(COOKIE);
    browser = browserSetup.browser;
    const page = await createPage(browserSetup.context);
    await page.goto(`${BASE_URL}/u/pianotell_ux_test/signature`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.SignaturePage', { timeout: 15_000 });
    await page.waitForTimeout(1000);
    check(
      'No JS errors',
      page._uxErrors.length === 0,
      page._uxErrors.length > 0 ? page._uxErrors.join('; ') : undefined,
    );
  } catch (error) {
    check('Spec completed without unhandled errors', false, error?.stack || String(error));
  } finally {
    try {
      await dbWriteSetting('signature.maximum_char_limit', '500');
      await dbWriteSetting('signature.maximum_image_count', '2');
      await clearCache();
      if (userId) {
        await patchSignature(userId, '   ', COOKIE);
      }
    } catch (error) {
      check('Cleanup completed', false, error?.stack || String(error));
    }

    if (browser) {
      await browser.close();
    }
  }

  if (failures.length) {
    console.log(`\n${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');
})();
