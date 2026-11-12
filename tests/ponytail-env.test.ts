#!/usr/bin/env node
import { test } from 'bun:test'

import assert from 'node:assert/strict'

import {
  getAppData,
  getClaudeConfigDir,
  getClaudePluginRoot,
  getClaudeProjectDir,
  getCodeBuddyConfigDir,
  getCodeBuddyPluginRoot,
  getCopilotPluginData,
  getCursorProjectDir,
  getCursorVersion,
  getGithubRefName,
  getGithubRefType,
  getPluginData,
  getPonytailDefaultMode,
  getPonytailHideStatus,
  getPonytailQuietStartup,
  getPonytailSubagentMatcher,
  getQoderConfigDir,
  getQoderSessionId,
  getXdgConfigHome,
} from '../hooks/ponytail-env.ts'

function withEnv(name: string, value: string | undefined, fn: () => void) {
  const prev = process.env[name]
  try {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
    fn()
  } finally {
    if (prev === undefined) delete process.env[name]
    else process.env[name] = prev
  }
}

const READ_GETTERS: [string, () => string | undefined][] = [
  ['XDG_CONFIG_HOME', getXdgConfigHome],
  ['APPDATA', getAppData],
  ['CLAUDE_CONFIG_DIR', getClaudeConfigDir],
  ['QODER_CONFIG_DIR', getQoderConfigDir],
  ['CODEBUDDY_CONFIG_DIR', getCodeBuddyConfigDir],
  ['PONYTAIL_DEFAULT_MODE', getPonytailDefaultMode],
  ['PONYTAIL_SUBAGENT_MATCHER', getPonytailSubagentMatcher],
  ['COPILOT_PLUGIN_DATA', getCopilotPluginData],
  ['PLUGIN_DATA', getPluginData],
  ['CLAUDE_PLUGIN_ROOT', getClaudePluginRoot],
  ['CODEBUDDY_PLUGIN_ROOT', getCodeBuddyPluginRoot],
  ['QODER_SESSION_ID', getQoderSessionId],
  ['CURSOR_VERSION', getCursorVersion],
  ['CURSOR_PROJECT_DIR', getCursorProjectDir],
  ['GITHUB_REF_TYPE', getGithubRefType],
  ['GITHUB_REF_NAME', getGithubRefName],
]

test('read getters treat unset and empty as undefined and pass values through', () => {
  for (const [name, getter] of READ_GETTERS) {
    withEnv(name, undefined, () => assert.equal(getter(), undefined, `${name} unset`))
    withEnv(name, '', () => assert.equal(getter(), undefined, `${name} empty`))
    withEnv(name, 'x', () => assert.equal(getter(), 'x', `${name} value`))
  }
})

test('quiet-startup and hide-status keep empty distinct from unset', () => {
  for (const [name, getter] of [
    ['PONYTAIL_QUIET_STARTUP', getPonytailQuietStartup],
    ['PONYTAIL_HIDE_STATUS', getPonytailHideStatus],
  ] as const) {
    withEnv(name, undefined, () => assert.equal(getter(), undefined, `${name} unset`))
    withEnv(name, '', () => assert.equal(getter(), '', `${name} empty`))
    withEnv(name, '1', () => assert.equal(getter(), '1', `${name} value`))
  }
})

test('CLAUDE_PROJECT_DIR trims and defaults unset or empty to empty string', () => {
  withEnv('CLAUDE_PROJECT_DIR', undefined, () => assert.equal(getClaudeProjectDir(), ''))
  withEnv('CLAUDE_PROJECT_DIR', '', () => assert.equal(getClaudeProjectDir(), ''))
  withEnv('CLAUDE_PROJECT_DIR', '  /repo  ', () => assert.equal(getClaudeProjectDir(), '/repo'))
})
