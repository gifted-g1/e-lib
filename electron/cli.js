'use strict';

// Admin command-line helper used by build/linux/unlock.sh. Runs without a window:
//
//   ELECTRON_RUN_AS_NODE=1 child-safe-elibrary <app>/electron/cli.js verify-admin [--data-dir DIR]
//
// Reads the admin password from the first line of stdin.
// Exit codes: 0 = password correct, 1 = wrong password / no admin, 2 = error.
const { createDb } = require('./db');
const paths = require('./paths');

function readLine() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
      const nl = data.indexOf('\n');
      if (nl !== -1) {
        process.stdin.pause();
        resolve(data.slice(0, nl).replace(/\r$/, ''));
      }
    });
    process.stdin.on('end', () => resolve(data.replace(/\r?\n$/, '')));
  });
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const dirIndex = args.indexOf('--data-dir');
  if (dirIndex !== -1 && args[dirIndex + 1]) process.env.ELIB_DATA_DIR = args[dirIndex + 1];

  if (command !== 'verify-admin') {
    console.error('Usage: cli.js verify-admin [--data-dir DIR]  (password on stdin)');
    return 2;
  }
  const db = createDb(paths.getDataDir());
  try {
    if (!db.hasAdmin()) {
      console.error('No admin account has been set up yet.');
      return 1;
    }
    const ok = await db.verifyAdmin(await readLine());
    if (ok) db.logActivity({ action: 'admin_cli_unlock', detail: ok.username });
    return ok ? 0 : 1;
  } finally {
    db.close();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err.message);
    process.exit(2);
  }
);
