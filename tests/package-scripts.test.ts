import { test } from 'bun:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.join(import.meta.dirname, '..')

// `bun test` from the root discovers every *.test.ts beneath it, pi-extension/test included,
// and `bun run ci` ends in that same script, so no per-subproject test script is needed.
test('root test script runs bun test, which covers the pi-extension tests', () => {
  const packageJson: { scripts: { test: string; ci: string } } = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
  )

  assert.equal(packageJson.scripts.test, 'bun test')
  assert.match(packageJson.scripts.ci, /bun run test$/)
  assert.ok(
    fs.readdirSync(path.join(root, 'pi-extension', 'test')).some((f) => f.endsWith('.test.ts')),
    'expected pi-extension/test to hold bun test files',
  )
})

test('CI pins every action to a commit', () => {
  const ci = fs.readFileSync(path.join(root, '.github', 'workflows', 'test.yml'), 'utf8')
  for (const action of ci.matchAll(/^\s+- uses: (.+)$/gm)) {
    assert.match(action[1] ?? '', /^[\w-]+\/[\w./-]+@[a-f0-9]{40} # v\d+(\.\d+)+\r?$/)
  }
})
