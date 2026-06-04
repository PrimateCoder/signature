import {
  createBrowser, createPage, createTestDiscussion,
  dbQuery, dbReadSetting, dbWriteSetting, clearCache, apiFetch,
  BASE_URL, CONTAINER, FLARUM_PATH,
} from '../../.pianotell/tests/ux/helpers.mjs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

const EXTRA_USERS = [
  {
    username: 'sig_test_member',
    email: 'sig_test_member@example.invalid',
    token: 'SIGTESTMEMBER000000000000000000001',
    password: 'test_password_e2e',
    groups: [3],
  },
  {
    username: 'sig_test_noperm',
    email: 'sig_test_noperm@example.invalid',
    token: 'SIGTESTNOPERM000000000000000000001',
    password: 'test_password_e2e',
    groups: [],
  },
];

const MEMBER = EXTRA_USERS[0];
const NO_PERM = EXTRA_USERS[1];
const PROVISIONER = fileURLToPath(new URL('../../.pianotell/tests/ux/provision-test-user.php', import.meta.url));
const CONTAINER_PROVISIONER = `${FLARUM_PATH}/storage/pianotell-signature-permissions-provision.php`;
const PHP_USER = process.env.PIANOTELL_FLARUM_UX_PHP_USER || 'docker';

function runProvisioner(action) {
  execFileSync('docker', ['cp', PROVISIONER, `${CONTAINER}:${CONTAINER_PROVISIONER}`], { stdio: 'inherit' });

  try {
    return execFileSync('docker', [
      'exec',
      '-u', PHP_USER,
      '-e', `PIANOTELL_FLARUM_UX_ACTION=${action}`,
      '-e', `PIANOTELL_FLARUM_UX_USERS=${JSON.stringify(EXTRA_USERS)}`,
      '-e', `PIANOTELL_FLARUM_UX_FLARUM_PATH=${FLARUM_PATH}`,
      CONTAINER,
      'php',
      CONTAINER_PROVISIONER,
    ], { encoding: 'utf8' });
  } finally {
    try {
      execFileSync('docker', ['exec', CONTAINER, 'rm', '-f', CONTAINER_PROVISIONER], { stdio: 'ignore' });
    } catch {}
  }
}

function runSqlStatement(sql) {
  const encodedSql = Buffer.from(sql, 'utf8').toString('base64');
  const php = [
    '$site = require getenv("PIANOTELL_FLARUM_UX_FLARUM_PATH") . "/site.php";',
    '$app = $site->bootApp();',
    '$db = $app->getContainer()->make("Illuminate\\\\Database\\\\ConnectionInterface");',
    '$db->statement(base64_decode("' + encodedSql + '"));',
  ].join(' ');

  execFileSync('docker', [
    'exec',
    '-u', PHP_USER,
    '-e', `PIANOTELL_FLARUM_UX_FLARUM_PATH=${FLARUM_PATH}`,
    CONTAINER,
    'php',
    '-r',
    php,
  ], { stdio: 'inherit' });
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

async function fetchUserId(username) {
  const id = await dbQuery(`SELECT id FROM users WHERE username = '${username}' LIMIT 1`);
  if (!id) {
    throw new Error(`Could not resolve user id for ${username}`);
  }

  return id.trim();
}

async function fetchGroups(userId) {
  const rows = await dbQuery(`SELECT group_id FROM group_user WHERE user_id = ${userId} ORDER BY group_id`);
  return rows ? rows.split(/\n+/).filter(Boolean) : [];
}

async function patchSignature(userId, token, signature) {
  const resp = await fetch(`${BASE_URL}/api/users/${userId}`, {
    method: 'PATCH',
    headers: {
      Authorization: 'Token ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: { attributes: { signature } },
    }),
  });

  let body = null;
  try {
    body = await resp.json();
  } catch {}

  return { resp, body };
}

async function deleteDiscussion(discussionId, token) {
  await fetch(`${BASE_URL}/api/discussions/${discussionId}`, {
    method: 'DELETE',
    headers: {
      Authorization: 'Token ' + token,
    },
  });
}

(async () => {
  console.log('permissions spec');

  const originalInlineEditing = await dbReadSetting('signature.allow_inline_editing');
  const adminSignature = `Admin signature ${Date.now()}`;
  const memberSignature = `Member signature ${Date.now() + 1}`;

  let adminUser;
  let memberId;
  let noPermId;
  let adminBrowser;
  let guestBrowser;
  let adminPage;
  let guestPage;
  let discussionId;
  let membersHaveSignature = false;

  try {
    runProvisioner('teardown');
    runProvisioner('setup');

    await dbWriteSetting('signature.allow_inline_editing', '0');
    await clearCache();

    adminUser = await fetchTestUser();
    memberId = await fetchUserId(MEMBER.username);
    noPermId = await fetchUserId(NO_PERM.username);

    membersHaveSignature = (await dbQuery("SELECT permission FROM group_permission WHERE permission = 'haveSignature' AND group_id = 3 LIMIT 1")) === 'haveSignature';

    const memberGroups = await fetchGroups(memberId);
    const noPermGroups = await fetchGroups(noPermId);
    check('Member user provisioned in group 3', memberGroups.includes('3'), `groups=${memberGroups.join(',') || '(none)'}`);
    check('No-permission user has no explicit groups', noPermGroups.length === 0, `groups=${noPermGroups.join(',') || '(none)'}`);

    const adminPatch = await patchSignature(adminUser.id, COOKIE, adminSignature);
    check('Admin API can set own signature', adminPatch.resp.status === 200,
      `status=${adminPatch.resp.status} body=${JSON.stringify(adminPatch.body)}`);

    const memberPatch = await patchSignature(memberId, MEMBER.token, memberSignature);
    check('Member API can set own signature', memberPatch.resp.status === 200,
      `status=${memberPatch.resp.status} body=${JSON.stringify(memberPatch.body)}`);

    discussionId = await createTestDiscussion(
      `Signature permissions ${Date.now()}`,
      'Permission UX discussion.',
      [],
      COOKIE
    );

    const adminSession = await createBrowser(COOKIE);
    adminBrowser = adminSession.browser;
    adminPage = await createPage(adminSession.context);

    const profileUrl = `${BASE_URL}/u/${adminUser.slug}`;
    const signatureUrl = `${profileUrl}/signature`;

    await adminPage.goto(profileUrl, { waitUntil: 'networkidle' });
    await adminPage.waitForSelector('.UserPage', { timeout: 15_000 });
    // FoF design: self-editing lives on Settings page; no nav link on own profile.
    await adminPage.goto(`${BASE_URL}/settings`, { waitUntil: 'networkidle' });
    await adminPage.waitForSelector('.SettingsPage', { timeout: 15_000 });
    check('Admin sees Signature section on Settings page', (await adminPage.$('.Settings-signature')) !== null);

    await adminPage.goto(signatureUrl, { waitUntil: 'networkidle' });
    await adminPage.waitForSelector('.SignaturePage', { timeout: 15_000 });
    const adminSignatureText = await adminPage.locator('.SignaturePage .Signature-content').textContent().catch(() => null);
    check('Signature page loads for admin', adminPage.url().includes('/signature') && adminSignatureText?.includes(adminSignature),
      `url=${adminPage.url()} text=${JSON.stringify(adminSignatureText)}`);

    const guestSession = await createBrowser(null);
    guestBrowser = guestSession.browser;
    guestPage = await createPage(guestSession.context);

    await guestPage.goto(`${BASE_URL}/d/${discussionId}`, { waitUntil: 'networkidle' });
    await guestPage.waitForSelector('.PostStream', { timeout: 15_000 });
    await guestPage.waitForSelector('.Post-signature .Signature-content', { timeout: 15_000 });
    const guestSignatureText = await guestPage.locator('.Post-signature .Signature-content').first().textContent().catch(() => null);
    check('Guest sees signature on posts', !!guestSignatureText && guestSignatureText.includes(adminSignature),
      `text=${JSON.stringify(guestSignatureText)}`);

    const guestEditButtons = await guestPage.getByRole('button', { name: 'Edit Signature' }).count();
    await guestPage.locator('.Post-signature .Signature-content').first().click();
    await guestPage.waitForTimeout(300);
    const guestEditor = await guestPage.$('.Post-signature .SignatureEditor textarea');
    check('Guest does not see edit controls', guestEditButtons === 0 && guestEditor === null,
      `buttons=${guestEditButtons} editor=${guestEditor ? 'present' : 'absent'}`);

    runSqlStatement("DELETE FROM group_permission WHERE permission = 'haveSignature' AND group_id = 3");

    const deniedPatch = await patchSignature(noPermId, NO_PERM.token, `Denied signature ${Date.now() + 2}`);
    check('API denies signature for user without permission', deniedPatch.resp.status === 403,
      `status=${deniedPatch.resp.status} body=${JSON.stringify(deniedPatch.body)}`);

    const jsErrors = [
      ...(adminPage?._uxErrors || []),
      ...(guestPage?._uxErrors || []),
    ];
    check('No JS errors', jsErrors.length === 0, jsErrors.length > 0 ? jsErrors.join('; ') : undefined);
  } finally {
    try {
      if (adminUser?.id) {
        await patchSignature(adminUser.id, COOKIE, '');
      }
    } catch {}

    try {
      if (memberId) {
        await patchSignature(memberId, MEMBER.token, '');
      }
    } catch {}

    try {
      if (discussionId) {
        await deleteDiscussion(discussionId, COOKIE);
      }
    } catch {}

    try {
      if (membersHaveSignature) {
        runSqlStatement("INSERT IGNORE INTO group_permission (permission, group_id) VALUES ('haveSignature', 3)");
      } else {
        runSqlStatement("DELETE FROM group_permission WHERE permission = 'haveSignature' AND group_id = 3");
      }
    } catch {}

    try {
      await dbWriteSetting('signature.allow_inline_editing', originalInlineEditing);
      await clearCache();
    } catch {}

    try {
      runProvisioner('teardown');
    } catch {}

    try {
      if (guestBrowser) await guestBrowser.close();
    } catch {}

    try {
      if (adminBrowser) await adminBrowser.close();
    } catch {}
  }

  if (failures.length) {
    console.log(`\n${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');
})();
