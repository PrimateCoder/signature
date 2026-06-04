/**
 * PianoTell Flarum UX Test Helpers
 *
 * Shared utilities for Playwright-based E2E tests against a Flarum dev container.
 * All configuration via PIANOTELL_FLARUM_UX_* env vars (see README.md).
 *
 * Usage from an extension:
 *   import { createBrowser, createPage, apiPostJson, dbQuery } from './.pianotell/tests/ux/helpers.mjs';
 */
import { chromium } from 'playwright';

const BASE = process.env.PIANOTELL_FLARUM_UX_BASE_URL || 'https://localhost';
const CONTAINER = process.env.PIANOTELL_FLARUM_UX_CONTAINER || 'pianotell-web';
const FLARUM_PATH = process.env.PIANOTELL_FLARUM_UX_FLARUM_PATH || '/var/www/html';

// Strip trailing slash from BASE for consistent URL construction
const BASE_URL = BASE.replace(/\/+$/, '');

/**
 * Launch a Chromium browser with a flarum_remember cookie set.
 * @param {string} token - Access token for authentication
 * @param {object} [options] - Optional overrides
 * @param {string} [options.domain] - Cookie domain (default: derived from BASE_URL)
 * @returns {{ browser, context }}
 */
export async function createBrowser(token, options = {}) {
  const url = new URL(BASE_URL);
  const domain = options.domain || url.hostname;
  const browser = await chromium.launch({ args: ['--ignore-certificate-errors'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  if (token) {
    await context.addCookies([{
      name: 'flarum_remember',
      value: token,
      domain,
      path: '/',
      secure: url.protocol === 'https:',
      httpOnly: true,
    }]);
  }
  return { browser, context };
}

/**
 * Create a new page with JS error capture.
 * Errors are collected in page._uxErrors (array of strings).
 * @param {import('playwright').BrowserContext} context
 * @returns {import('playwright').Page}
 */
export async function createPage(context) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => {
    // Ignore known Flarum core errors
    if (err.message.includes('@context')) return;
    errors.push(err.message);
  });
  page._uxErrors = errors;
  return page;
}

/**
 * GET a Flarum JSON:API endpoint.
 * @param {string} path - API path (e.g. '/discussions/123')
 * @param {string} [token] - Auth token (optional)
 * @returns {Promise<object>} Parsed JSON response
 */
export async function apiFetch(path, token) {
  const resp = await fetch(BASE_URL + '/api' + path, {
    headers: token ? { 'Authorization': 'Token ' + token } : {},
  });
  return resp.json();
}

/**
 * POST JSON to a Flarum API endpoint.
 * @param {string} path - API path
 * @param {object} body - Request body (will be JSON.stringified)
 * @param {string} [token] - Auth token (optional)
 * @returns {Promise<object>} Parsed JSON response
 */
export async function apiPostJson(path, body, token) {
  const resp = await fetch(BASE_URL + '/api' + path, {
    method: 'POST',
    headers: {
      'Authorization': 'Token ' + (token || ''),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return resp.json();
}

/**
 * PATCH JSON to a Flarum API endpoint.
 * @param {string} path - API path (e.g. '/posts/42')
 * @param {object} body - Request body (will be JSON.stringified)
 * @param {string} [token] - Auth token (optional)
 * @returns {Promise<object>} Parsed JSON response
 */
export async function apiPatchJson(path, body, token) {
  const resp = await fetch(BASE_URL + '/api' + path, {
    method: 'PATCH',
    headers: {
      'Authorization': 'Token ' + (token || ''),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return resp.json();
}

/**
 * Run arbitrary SQL via Flarum's bootstrap (no DB credentials needed).
 * Returns tab-separated rows as a string.
 * @param {string} sql - SQL query
 * @returns {Promise<string>} Query result
 */
export async function dbQuery(sql) {
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
  const { execSync } = await import('child_process');
  const phpSql = sql.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const php = [
    '<?php',
    '$site = require "' + FLARUM_PATH + '/site.php";',
    '$app = $site->bootApp();',
    '$db = $app->getContainer()->make("Illuminate\\\\Database\\\\ConnectionInterface");',
    '$rows = $db->select("' + phpSql + '");',
    'foreach ($rows as $r) { echo implode("\\t", (array)$r) . "\\n"; }',
  ].join('\n');
  const uid = process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const tmpFile = path.join(os.tmpdir(), 'pianotell-ux-dbquery-' + uid + '.php');
  const containerTmp = '/tmp/_dbquery-' + uid + '.php';
  fs.writeFileSync(tmpFile, php);
  try {
    execSync('docker cp "' + tmpFile + '" ' + CONTAINER + ':' + containerTmp, { encoding: 'utf8' });
    return execSync('docker exec ' + CONTAINER + ' php ' + containerTmp, { encoding: 'utf8' }).trim();
  } finally {
    fs.unlinkSync(tmpFile);
    execSync('docker exec ' + CONTAINER + ' rm -f ' + containerTmp, { encoding: 'utf8' });
  }
}

/**
 * Read a Flarum setting value (hex-encoded round-trip for safe escaping).
 * @param {string} key - Setting key
 * @returns {Promise<string>} Setting value
 */
export async function dbReadSetting(key) {
  const hex = await dbQuery("SELECT HEX(value) FROM settings WHERE settings.key = '" + key + "'");
  if (!hex) return '';
  return Buffer.from(hex, 'hex').toString('utf8');
}

/**
 * Write a Flarum setting value (hex-encoded for safe escaping).
 * @param {string} key - Setting key
 * @param {string} value - Setting value
 */
export async function dbWriteSetting(key, value) {
  const hex = Buffer.from(value, 'utf8').toString('hex').toUpperCase();
  await dbQuery("UPDATE settings SET value = UNHEX('" + hex + "') WHERE settings.key = '" + key + "'");
}

/**
 * Clear Flarum's cache (storage/cache + formatter cache).
 */
export async function clearCache() {
  const { execSync } = await import('child_process');
  execSync('docker exec ' + CONTAINER + ' php flarum cache:clear', { encoding: 'utf8' });
}

/**
 * Create a discussion via Flarum's JSON:API.
 * @param {string} title
 * @param {string} content
 * @param {number[]} tags - Array of tag IDs
 * @param {string} token - Auth token
 * @returns {Promise<string>} Discussion ID
 */
export async function createTestDiscussion(title, content, tags, token) {
  const data = await apiPostJson('/discussions', {
    data: {
      type: 'discussions',
      attributes: { title, content: content || 'Test thread.' },
      relationships: {
        tags: { data: tags.map(id => ({ type: 'tags', id: String(id) })) }
      }
    }
  }, token);
  return data.data.id;
}

/**
 * DELETE a Flarum API endpoint.
 * Throws on non-2xx responses to prevent silent cleanup failures.
 * @param {string} path - API path (e.g. '/discussions/42')
 * @param {string} [token] - Auth token (optional)
 * @returns {Promise<{resp: Response, body: object|null}>}
 */
export async function apiDeleteJson(path, token) {
  const resp = await fetch(BASE_URL + '/api' + path, {
    method: 'DELETE',
    headers: token ? { 'Authorization': 'Token ' + token } : {},
  });

  let body = null;
  try { body = await resp.json(); } catch {}

  if (!resp.ok) {
    throw new Error(`DELETE ${path} failed: ${resp.status} ${JSON.stringify(body)}`);
  }

  return { resp, body };
}

/**
 * Resolve the primary test user via the Flarum API.
 * @param {string} [token] - Auth token (defaults to PIANOTELL_FLARUM_UX_COOKIE env var)
 * @param {string} [username='pianotell_ux_test'] - Username to look up
 * @returns {Promise<{id: string, username: string, slug: string}>}
 */
export async function fetchTestUser(token = process.env.PIANOTELL_FLARUM_UX_COOKIE, username = 'pianotell_ux_test') {
  const users = await apiFetch(`/users?filter[q]=${encodeURIComponent(username)}`, token);
  const user = users.data?.find((entry) => entry.attributes?.username === username);

  if (!user) {
    throw new Error(`Could not resolve user '${username}' via API`);
  }

  return {
    id: user.id,
    username: user.attributes?.username || username,
    slug: user.attributes?.slug || user.attributes?.username || username,
  };
}

/**
 * Execute a write SQL statement (INSERT/UPDATE/DELETE) via Flarum's bootstrap.
 * Unlike dbQuery() which handles SELECT and returns rows, this executes
 * statements that modify data and returns a boolean success indicator.
 * @param {string} sql - SQL statement
 * @returns {Promise<boolean>} True if the statement executed successfully
 */
export async function dbExecStatement(sql) {
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
  const { execSync } = await import('child_process');
  const phpSql = sql.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const php = [
    '<?php',
    '$site = require "' + FLARUM_PATH + '/site.php";',
    '$app = $site->bootApp();',
    '$db = $app->getContainer()->make("Illuminate\\\\Database\\\\ConnectionInterface");',
    '$result = $db->statement("' + phpSql + '");',
    'echo $result ? "1" : "0";',
  ].join('\n');
  const uid = process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const tmpFile = path.join(os.tmpdir(), 'pianotell-ux-dbexec-' + uid + '.php');
  const containerTmp = '/tmp/_dbexec-' + uid + '.php';
  fs.writeFileSync(tmpFile, php);
  try {
    execSync('docker cp "' + tmpFile + '" ' + CONTAINER + ':' + containerTmp, { encoding: 'utf8' });
    const result = execSync('docker exec ' + CONTAINER + ' php ' + containerTmp, { encoding: 'utf8' }).trim();
    return result === '1';
  } finally {
    fs.unlinkSync(tmpFile);
    execSync('docker exec ' + CONTAINER + ' rm -f ' + containerTmp, { encoding: 'utf8' });
  }
}

export { BASE_URL, CONTAINER, FLARUM_PATH };

// ---------------------------------------------------------------------------
// Test runner helpers
// ---------------------------------------------------------------------------

/**
 * Simple assertion logger. Prints ✓/✗ to stdout and collects failures.
 * @param {Array} failures - Array to push failures into
 * @returns {(label: string, ok: boolean, detail?: string) => void}
 */
export function createCheck(failures) {
  return function check(label, ok, detail) {
    if (ok) {
      console.log(`  ✓ ${label}`);
    } else {
      console.log(`  ✗ ${label}  ${detail ?? ''}`);
      failures.push({ label, detail });
    }
  };
}

/**
 * Open the composer by clicking the "new discussion" button.
 * Tries several selectors to handle different Flarum pages/states.
 * @param {import('playwright').Page} page
 */
export async function openComposer(page) {
  const selectors = [
    '.IndexPage-newDiscussion',
    'button[onclick*="composer"]',
    'button.Button--primary',
  ];
  for (const sel of selectors) {
    const btn = await page.$(sel);
    if (btn) {
      await btn.click();
      return;
    }
  }
  throw new Error('Could not find a "new discussion" button to open the composer.');
}

/**
 * Run a spec function with standard browser setup and failure reporting.
 *
 * Handles:
 *   - Browser launch with cookie auth
 *   - Viewport configuration
 *   - Exception capture + failure screenshot
 *   - _failures.json output
 *   - Process exit code
 *
 * @param {object} opts
 * @param {string} [opts.specName] - Name for log output
 * @param {number} [opts.width=1280] - Viewport width
 * @param {number} [opts.height=900] - Viewport height
 * @param {number} [opts.deviceScaleFactor=1] - Device scale
 * @param {boolean} [opts.acceptDownloads=false] - Accept file downloads
 * @param {(ctx: {browser, context, page, check, failures, BASE, COOKIE}) => Promise<void>} fn
 */
export async function runSpec(opts, fn) {
  const fs = await import('fs');
  const path = await import('path');

  const COOKIE = process.env.PIANOTELL_FLARUM_UX_COOKIE;
  if (!COOKIE) {
    console.error('PIANOTELL_FLARUM_UX_COOKIE must be set. See tests/ux/README.md.');
    process.exit(2);
  }

  const {
    specName = 'spec',
    width = 1280,
    height = 900,
    deviceScaleFactor = 1,
    acceptDownloads = false,
  } = opts;

  const failures = [];
  const check = createCheck(failures);
  let browser;

  try {
    browser = await chromium.launch();
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width, height },
      deviceScaleFactor,
      acceptDownloads,
    });
    await context.addCookies([
      { name: 'flarum_remember', value: COOKIE, url: BASE_URL },
    ]);
    const page = await context.newPage();

    await fn({ browser, context, page, check, failures, BASE: BASE_URL, COOKIE });
  } catch (err) {
    failures.push({ label: 'unhandled exception', detail: err.message });
    console.error(`  EXCEPTION: ${err.message}`);
    if (browser) {
      try {
        const pages = browser.contexts().flatMap((c) => c.pages());
        if (pages[0]) {
          // Caller should pass __dirname-relative path; fall back to cwd
          const shotDir = opts.outputDir || process.cwd();
          const shotPath = path.resolve(shotDir, '_failure.png');
          await pages[0].screenshot({ path: shotPath, fullPage: true });
          console.error(`  saved failure screenshot to ${shotPath}`);
        }
      } catch {}
    }
  } finally {
    if (browser) await browser.close();
  }

  // Write failures JSON for CI/tooling
  if (opts.outputDir) {
    const failPath = path.resolve(opts.outputDir, '_failures.json');
    fs.writeFileSync(failPath, JSON.stringify(failures, null, 2));
  }

  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed:`);
    for (const f of failures) console.error(` - ${f.label}: ${f.detail ?? ''}`);
    process.exit(1);
  }
  console.log(`\nAll ${specName} checks passed.`);
}

/**
 * Compare a screenshot against a committed baseline PNG.
 *
 * When `update` is true (or the baseline doesn't exist yet), the actual
 * screenshot is written as the new baseline and the check is skipped.
 *
 * @param {import('playwright').Page} page - Playwright page
 * @param {object} opts
 * @param {string} opts.baselinePath - Absolute path to baseline PNG
 * @param {string} [opts.diffPath] - Path to write diff PNG on failure
 * @param {string} [opts.actualPath] - Path to write actual PNG on failure
 * @param {object} [opts.clip] - {x, y, width, height} clip region (omit for full viewport)
 * @param {number} [opts.threshold=0.1] - pixelmatch threshold (0 = exact, 1 = lenient)
 * @param {number} [opts.maxDiffPixels=50] - max mismatched pixels before failure
 * @param {boolean} [opts.update=false] - write actual as new baseline
 * @returns {Promise<{pass: boolean, diffPixels?: number, detail?: string}>}
 */
export async function compareScreenshot(page, opts) {
  const fs = await import('fs');
  const { PNG } = await import('pngjs');
  const pixelmatch = (await import('pixelmatch')).default;

  const {
    baselinePath,
    diffPath = baselinePath.replace('.png', '-diff.png'),
    actualPath = baselinePath.replace('.png', '-actual.png'),
    clip,
    threshold = 0.1,
    maxDiffPixels = 50,
    update = false,
  } = opts;

  const screenshotOpts = { omitBackground: false };
  if (clip) screenshotOpts.clip = clip;
  const actual = await page.screenshot(screenshotOpts);

  // Update mode or first run: write baseline and return
  if (update || !fs.existsSync(baselinePath)) {
    const dir = (await import('path')).dirname(baselinePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(baselinePath, actual);
    return { pass: true, detail: `baseline written: ${baselinePath}` };
  }

  const expectedPng = PNG.sync.read(fs.readFileSync(baselinePath));
  const actualPng = PNG.sync.read(actual);

  if (expectedPng.width !== actualPng.width || expectedPng.height !== actualPng.height) {
    fs.writeFileSync(actualPath, actual);
    return {
      pass: false,
      detail: `dimensions changed: ${expectedPng.width}×${expectedPng.height} → ${actualPng.width}×${actualPng.height} (actual saved to ${actualPath})`,
    };
  }

  const { width, height } = expectedPng;
  const diffImg = new PNG({ width, height });
  const diffPixels = pixelmatch(
    expectedPng.data, actualPng.data, diffImg.data,
    width, height, { threshold }
  );

  if (diffPixels > maxDiffPixels) {
    fs.writeFileSync(diffPath, PNG.sync.write(diffImg));
    fs.writeFileSync(actualPath, actual);
    return {
      pass: false,
      diffPixels,
      detail: `${diffPixels} pixels differ (max ${maxDiffPixels}). Diff: ${diffPath}`,
    };
  }

  return { pass: true, diffPixels };
}
