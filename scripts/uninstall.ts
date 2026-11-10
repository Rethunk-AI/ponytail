#!/usr/bin/env node
// ponytail — removes state ponytail wrote outside the plugin's own files:
// the mode flag, the config file, and its entries in
// ~/.cursor/hooks.json. Plugin files themselves are removed by each host's
// own uninstall command (see README); this only cleans up what those
// commands can't see.

import fs from 'node:fs'

import os from 'node:os'
import path from 'node:path'
import { getClaudeDir, getConfigPath, getQoderDir } from '../hooks/ponytail-config.ts'
import cursorHooks from './cursor-hooks.ts'

function removeIfExists(filePath, label) {
  try {
    fs.unlinkSync(filePath)
    console.log(`Removed ${label}: ${filePath}`)
  } catch (e) {
    if (e.code !== 'ENOENT') {
      throw e
    }
  }
}

removeIfExists(path.join(getClaudeDir(), '.ponytail-active'), 'mode flag')
removeIfExists(path.join(os.homedir(), '.cursor', '.ponytail-active'), 'Cursor mode flag')
removeIfExists(path.join(getQoderDir(), '.ponytail-active'), 'Qoder mode flag')
for (const dir of [
  path.join(getClaudeDir(), 'ponytail-modes'),
  path.join(os.homedir(), '.cursor', 'ponytail-modes'),
  path.join(
    process.env.CODEBUDDY_CONFIG_DIR || path.join(os.homedir(), '.codebuddy'),
    'ponytail-modes',
  ),
]) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true })
    console.log(`Removed per-project mode flags: ${dir}`)
  }
}
removeIfExists(
  path.join(
    process.env.CODEBUDDY_CONFIG_DIR || path.join(os.homedir(), '.codebuddy'),
    '.ponytail-active',
  ),
  'CodeBuddy mode flag',
)
removeIfExists(
  path.join(
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
    'opencode',
    '.ponytail-active',
  ),
  'OpenCode mode flag',
)
removeIfExists(getConfigPath(), 'config file')

// Cursor hooks (#817): drop only ponytail's entries from ~/.cursor/hooks.json,
// keep every other hook the user configured there.
try {
  const hooksFile = cursorHooks.uninstall('user')
  if (hooksFile) {
    console.log(`Removed ponytail hooks from ${hooksFile}`)
  }
} catch (e) {
  if (e instanceof SyntaxError) {
    // ponytail: malformed hooks.json — can't safely edit it; leave intact, warn
    console.warn(
      `~/.cursor/hooks.json is malformed — could not remove the ponytail hook entries. Remove them manually from: ${cursorHooks.hooksPath('user')} (${e.message})`,
    )
  } else {
    throw e
  }
}
