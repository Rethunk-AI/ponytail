#!/usr/bin/env node
// Smoke test for the Copilot plugin adapter: keep command wiring minimal and
// ensure the debt command is part of the shared command surface.

import { test } from 'bun:test'

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.join(import.meta.dirname, '..')
const REQUIRED_COMMAND_FILES = [
  'ponytail.toml',
  'ponytail-review.toml',
  'ponytail-audit.toml',
  'ponytail-debt.toml',
  'ponytail-gain.toml',
  'ponytail-help.toml',
]

function readJSON(relPath) {
  return JSON.parse(fs.readFileSync(path.join(root, relPath), 'utf8'))
}

test('copilot plugin command directory includes ponytail-debt', () => {
  const manifest = readJSON('.github/plugin/plugin.json')
  assert.equal(manifest.name, 'ponytail')
  assert.equal(manifest.commands, 'commands/')

  for (const file of REQUIRED_COMMAND_FILES) {
    assert.ok(
      fs.existsSync(path.join(root, manifest.commands, file)),
      `missing command file: ${manifest.commands}${file}`,
    )
  }
})
