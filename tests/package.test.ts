#!/usr/bin/env node
// The README tells users to run `node scripts/uninstall.ts`, so the npm package
// must actually ship it. Guard the files entry so it can't silently drop out.

import { test } from 'bun:test'

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.join(import.meta.dirname, '..')

test('npm package ships the advertised cleanup script', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.ok(
    pkg.files.includes('scripts/uninstall.ts'),
    'package.json "files" must include scripts/uninstall.ts (README tells users to run it)',
  )
  // And the file it points at must exist.
  assert.ok(
    fs.existsSync(path.join(root, 'scripts', 'uninstall.ts')),
    'scripts/uninstall.ts is listed in files but missing on disk',
  )
})
