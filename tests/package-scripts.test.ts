#!/usr/bin/env node

import { test } from 'bun:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.join(import.meta.dirname, '..')

test('root npm test covers bundled subprojects', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

  assert.match(packageJson.scripts.test, /npm test --prefix pi-extension/)
})

test('CI pins every action to a commit', () => {
  const ci = fs.readFileSync(path.join(root, '.github', 'workflows', 'test.yml'), 'utf8')
  for (const action of ci.matchAll(/^\s+- uses: (.+)$/gm)) {
    assert.match(action[1], /^actions\/[\w-]+@[a-f0-9]{40} # v\d+\.\d+\.\d+\r?$/)
  }
})
