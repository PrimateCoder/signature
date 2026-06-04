<?php
/*
 * Provision deterministic test users + remember-me access tokens for
 * PianoTell Flarum extension UX test suites. Idempotent: safe to re-run.
 *
 * Self-bootstrapping: loads Flarum's site.php on its own, so it runs as
 * a normal `php` script with no wrapper.
 *
 *   docker exec -u <flarum-user> <container> \
 *     env PIANOTELL_FLARUM_UX_FLARUM_PATH=/var/www/html \
 *         PIANOTELL_FLARUM_UX_USERS='[{"username":"pianotell_ux_test", ...}]' \
 *     php /path/to/provision-test-user.php
 *
 * The Flarum install path defaults to /var/www/html; override via
 * PIANOTELL_FLARUM_UX_FLARUM_PATH.
 *
 * The script knows nothing about your database driver, credentials, or
 * schema — those come from Flarum's own config.php via the bootstrap
 * below.
 *
 * Configuration
 * -------------
 * PIANOTELL_FLARUM_UX_USERS  JSON array of user specs:
 *   [
 *     {
 *       "username": "test_admin",
 *       "email":    "test_admin@example.invalid",
 *       "token":    "TEST_TOKEN_ADMIN_0000000000000000000",  // <=40 chars
 *       "password": "test_password_e2e",                     // optional
 *       "groups":   [1]                                       // group IDs
 *     },
 *     ...
 *   ]
 * If unset, falls back to a single-user default for the flamoji harness.
 *
 * PIANOTELL_FLARUM_UX_ACTION  "setup" (default) or "teardown".
 *   teardown removes posts owned by each user, discussions they
 *   started (with discussion_tag cleanup), their tokens, group
 *   memberships, then the user row.
 *
 * Output
 * ------
 * On setup, one line per user on stdout:
 *   COOKIE <username>=<token>
 * Plus, when exactly one user is provisioned, an extra back-compat line:
 *   COOKIE=<token>
 * Diagnostics go to stderr; non-zero exit on failure.
 *
 * NOTE: `access_tokens.token` is VARCHAR(40). Tokens longer than 40
 * chars are silently truncated by MariaDB → the cookie the harness
 * emits won't match the row in the DB → silent guest auth. Keep tokens
 * at exactly 40 chars or less.
 *
 * NOTE: This script does NOT create groups. Group IDs in the config
 * must already exist (e.g. extension migrations create custom groups
 * like recitals' "Recital Coordinator" id=8). Built-in IDs:
 *   1 = Administrator, 2 = Guest, 3 = Member, 4 = Mod.
 */

$flarumPath = rtrim(getenv('PIANOTELL_FLARUM_UX_FLARUM_PATH') ?: '/var/www/html', '/');
$sitePhp = $flarumPath . '/site.php';
if (! is_file($sitePhp)) {
    fwrite(STDERR, "[provision] cannot find Flarum site bootstrap at $sitePhp\n");
    fwrite(STDERR, "[provision] set PIANOTELL_FLARUM_UX_FLARUM_PATH to your Flarum install dir.\n");
    exit(2);
}

$site = require $sitePhp;
$app = $site->bootApp();

use Flarum\Group\Group;
use Flarum\Http\RememberAccessToken;
use Flarum\User\User;
use Illuminate\Contracts\Hashing\Hasher;

// ---- Resolve user config ---------------------------------------------------

$action = strtolower(getenv('PIANOTELL_FLARUM_UX_ACTION') ?: 'setup');
if (! in_array($action, ['setup', 'teardown'], true)) {
    fwrite(STDERR, "[provision] PIANOTELL_FLARUM_UX_ACTION must be 'setup' or 'teardown' (got '$action')\n");
    exit(2);
}

$usersJson = getenv('PIANOTELL_FLARUM_UX_USERS');
if ($usersJson === false || $usersJson === '') {
    // Default: single PianoTell UX test user.
    $users = [[
        'username' => 'pianotell_ux_test',
        'email'    => 'pianotell-ux-test@example.invalid',
        'token'    => 'TEST_PIANOTELL_UX_HARNESS_00000000000000',
        'password' => null,
        'groups'   => [Group::ADMINISTRATOR_ID],
    ]];
    fwrite(STDERR, "[provision] PIANOTELL_FLARUM_UX_USERS unset; using single-user default\n");
} else {
    $users = json_decode($usersJson, true);
    if (! is_array($users) || $users === []) {
        fwrite(STDERR, "[provision] PIANOTELL_FLARUM_UX_USERS must be a non-empty JSON array\n");
        exit(2);
    }
}

foreach ($users as $i => $u) {
    foreach (['username', 'email', 'token'] as $req) {
        if (! isset($u[$req]) || ! is_string($u[$req]) || $u[$req] === '') {
            fwrite(STDERR, "[provision] user[$i] missing required field '$req'\n");
            exit(2);
        }
    }
    if (strlen($u['token']) > 40) {
        fwrite(STDERR, "[provision] user[$i] token exceeds 40 chars (would be truncated by MariaDB)\n");
        exit(2);
    }
}

// ---- Teardown --------------------------------------------------------------

if ($action === 'teardown') {
    foreach ($users as $u) {
        $user = User::query()->where('username', $u['username'])->first();
        if (! $user) {
            fwrite(STDERR, "[provision] teardown: user '{$u['username']}' not found, skipping\n");
            continue;
        }
        $uid = $user->id;

        // Delete posts (and any discussions the user started). Eloquent's
        // User::delete() doesn't cascade posts/discussions in Flarum, so
        // we do it explicitly via query builder for speed.
        $db = $user->getConnection();
        $ownedDiscussionIds = $db->table('discussions')->where('user_id', $uid)->pluck('id')->all();
        $postCount = $db->table('posts')->where('user_id', $uid)->delete();
        if ($ownedDiscussionIds) {
            $db->table('discussion_tag')->whereIn('discussion_id', $ownedDiscussionIds)->delete();
            $db->table('discussions')->whereIn('id', $ownedDiscussionIds)->delete();
        }
        $db->table('access_tokens')->where('user_id', $uid)->delete();
        $db->table('group_user')->where('user_id', $uid)->delete();
        $user->delete();

        fwrite(STDERR, sprintf(
            "[provision] teardown: removed '%s' (id=%d, %d posts, %d discussions)\n",
            $u['username'], $uid, $postCount, count($ownedDiscussionIds)
        ));
    }
    exit(0);
}

// ---- Setup -----------------------------------------------------------------

$hasher = $app->getContainer()->make(Hasher::class);
$cookieLines = [];

foreach ($users as $u) {
    $username = $u['username'];
    $email    = $u['email'];
    $token    = $u['token'];
    $groups   = $u['groups'] ?? [];
    $password = $u['password'] ?? null;

    $user = User::query()->where('username', $username)->first();
    if (! $user) {
        $user = new User();
        $user->username = $username;
        $user->email = $email;
        $user->password = $password !== null
            ? $hasher->make($password)
            : bin2hex(random_bytes(32)); // unguessable; cookie is the only auth path
        $user->is_email_confirmed = true;
        $user->joined_at = new \DateTime();
        $user->save();
        fwrite(STDERR, "[provision] created user '$username' (id={$user->id})\n");
    } else {
        $changed = false;
        if ($user->email !== $email) {
            $user->email = $email;
            $changed = true;
        }
        if ($password !== null) {
            // Always rewrite the hash on setup so the documented password
            // really works for UI logins, even after rotations.
            $user->password = $hasher->make($password);
            $changed = true;
        }
        if ($changed) {
            $user->save();
        }
        fwrite(STDERR, "[provision] reusing user '$username' (id={$user->id})\n");
    }

    // Group sync: add any missing memberships (don't remove unrelated ones).
    $groups = array_values(array_unique(array_map('intval', $groups)));
    if ($groups) {
        $current = $user->groups()->pluck('groups.id')->map('intval')->all();
        $missing = array_diff($groups, $current);
        if ($missing) {
            $user->groups()->syncWithoutDetaching($missing);
            fwrite(STDERR, "[provision]   added to groups: " . implode(',', $missing) . "\n");
        }
    }

    // Replace any prior remember tokens for this user so the cookie value
    // we hand the test is the only valid one.
    RememberAccessToken::query()
        ->where('user_id', $user->id)
        ->where('token', '!=', $token)
        ->where('type', RememberAccessToken::$type)
        ->delete();

    $row = RememberAccessToken::query()->where('token', $token)->first();
    if (! $row) {
        $row = new RememberAccessToken();
        $row->token = $token;
        $row->user_id = $user->id;
        $row->type = RememberAccessToken::$type;
        $row->created_at = new \DateTime();
        $row->last_activity_at = new \DateTime();
        $row->title = 'pianotell flarum-ux harness';
        $row->save();
        fwrite(STDERR, "[provision]   created remember-me token\n");
    } else {
        $row->user_id = $user->id;
        $row->last_activity_at = new \DateTime();
        $row->save();
        fwrite(STDERR, "[provision]   refreshed remember-me token\n");
    }

    $cookieLines[] = ['username' => $username, 'token' => $token];
}

foreach ($cookieLines as $c) {
    echo "COOKIE {$c['username']}={$c['token']}\n";
}
// Back-compat: harnesses that only need one cookie can grep ^COOKIE=.
if (count($cookieLines) === 1) {
    echo 'COOKIE=' . $cookieLines[0]['token'] . "\n";
}
