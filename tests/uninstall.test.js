#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');

function runUninstall(env) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'uninstall.js')], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

delete process.env.CLAUDE_CONFIG_DIR;

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-uninstall-'));
process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }));

const home = path.join(temp, 'home');
const claudeDir = path.join(home, '.claude');
fs.mkdirSync(claudeDir, { recursive: true });

const flagPath = path.join(claudeDir, '.ponytail-active');
fs.writeFileSync(flagPath, 'full');

// Qoder keeps its flag in ~/.qoder (hooks/ponytail-runtime.js), and since
// #676 it holds "off", so a leftover would start a reinstall switched off.
const qoderFlagPath = path.join(home, '.qoder', '.ponytail-active');
fs.mkdirSync(path.dirname(qoderFlagPath), { recursive: true });
fs.writeFileSync(qoderFlagPath, 'ultra');
const qoderCustomDir = path.join(temp, 'qoder-custom-config');
const qoderCustomFlagPath = path.join(qoderCustomDir, '.ponytail-active');
fs.mkdirSync(qoderCustomDir, { recursive: true });
fs.writeFileSync(qoderCustomFlagPath, 'lite');

// OpenCode keeps its flag beside its own config; a leftover "off" would start a
// reinstall switched off.
const opencodeFlagPath = path.join(temp, 'config-home', 'opencode', '.ponytail-active');
fs.mkdirSync(path.dirname(opencodeFlagPath), { recursive: true });
fs.writeFileSync(opencodeFlagPath, 'off');

const configDir = path.join(temp, 'config-home', 'ponytail');
fs.mkdirSync(configDir, { recursive: true });
const configPath = path.join(configDir, 'config.json');
fs.writeFileSync(configPath, JSON.stringify({ defaultMode: 'ultra' }));

// Cursor (#817): the Cursor mode flag goes too, and ~/.cursor/hooks.json loses
// only ponytail's entries; the user's other hooks stay.
const cursorDir = path.join(home, '.cursor');
fs.mkdirSync(cursorDir, { recursive: true });
const cursorFlagPath = path.join(cursorDir, '.ponytail-active');
fs.writeFileSync(cursorFlagPath, 'lite');
const cursorHooksPath = path.join(cursorDir, 'hooks.json');
fs.writeFileSync(cursorHooksPath, JSON.stringify({
  version: 1,
  hooks: {
    sessionStart: [
      { command: './hooks/mine.sh' },
      { command: 'node "/p/ponytail/hooks/ponytail-activate.js"', timeout: 5 },
    ],
    beforeSubmitPrompt: [{ command: 'node "/p/ponytail/hooks/ponytail-mode-tracker.js"', timeout: 5 }],
  },
}));

const env = {
  HOME: home,
  USERPROFILE: home,
  XDG_CONFIG_HOME: path.join(temp, 'config-home'),
};

let result = runUninstall(env);
assert.equal(result.status, 0, result.stderr);
assert.equal(fs.existsSync(flagPath), false, 'mode flag must be removed');
assert.equal(fs.existsSync(qoderFlagPath), false, 'Qoder mode flag must be removed');
assert.equal(fs.existsSync(opencodeFlagPath), false, 'OpenCode mode flag must be removed');
assert.equal(fs.existsSync(qoderCustomFlagPath), true, 'default Qoder uninstall must not touch a separate custom config');
assert.equal(fs.existsSync(configPath), false, 'config file must be removed');
assert.equal(fs.existsSync(cursorFlagPath), false, 'Cursor mode flag must be removed');
assert.deepEqual(
  JSON.parse(fs.readFileSync(cursorHooksPath, 'utf8')),
  { version: 1, hooks: { sessionStart: [{ command: './hooks/mine.sh' }] } },
  "only ponytail's entries may leave ~/.cursor/hooks.json",
);

result = runUninstall({ ...env, QODER_CONFIG_DIR: qoderCustomDir });
assert.equal(result.status, 0, result.stderr);
assert.equal(fs.existsSync(qoderCustomFlagPath), false, 'Qoder custom config mode flag must be removed');

// A malformed ~/.cursor/hooks.json must not crash the script either (#817).
const malformedHooks = '{ "version": 1, "hooks": { broken';
fs.writeFileSync(cursorHooksPath, malformedHooks);

result = runUninstall(env);
assert.equal(result.status, 0, result.stderr);
assert.ok(
  /hooks\.json is malformed/.test(result.stdout + result.stderr),
  'must warn that the Cursor hook entries could not be removed',
);
assert.equal(
  fs.readFileSync(cursorHooksPath, 'utf8'),
  malformedHooks,
  'malformed hooks.json must be left unchanged',
);

// Running on an already-clean machine must not throw.
result = runUninstall({ HOME: path.join(temp, 'home-empty'), USERPROFILE: path.join(temp, 'home-empty') });
assert.equal(result.status, 0, result.stderr);

console.log('uninstall script checks passed');
