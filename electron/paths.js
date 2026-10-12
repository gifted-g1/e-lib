'use strict';

// Shared by the Electron app and the CLI (electron/cli.js), so it must not require('electron').
const os = require('os');
const path = require('path');

function getDataDir() {
  if (process.env.ELIB_DATA_DIR) return path.resolve(process.env.ELIB_DATA_DIR);
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'child-safe-elibrary');
}

function getContentDir(dataDir = getDataDir()) {
  return path.join(dataDir, 'content');
}

module.exports = { getDataDir, getContentDir };
