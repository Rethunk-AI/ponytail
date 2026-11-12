#!/usr/bin/env node
import { test } from 'bun:test'

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = path.join(import.meta.dirname, '..')
const script = path.join(root, 'scripts/check-versions.ts')
const version: string = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
const okLog = `All 7 version files pinned at ${version}.\n`

function run(extra: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_REF_TYPE: undefined, GITHUB_REF_NAME: undefined, ...extra },
  })
}

const cases: [string, NodeJS.ProcessEnv, number, string, RegExp | string][] = [
  ['agrees when not a tag run', {}, 0, okLog, ''],
  [
    'release tag matches shared version',
    { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: `v${version}` },
    0,
    okLog,
    '',
  ],
  [
    'release tag mismatch is reported',
    { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v0.0.0' },
    1,
    '',
    `release tag v0.0.0 does not match version ${version}; bump the version files before tagging\nAlign the version fields (see issue #260) so every manifest shares one version.\n`,
  ],
  [
    'non-semver tag is ignored',
    { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'nightly' },
    0,
    okLog,
    '',
  ],
  [
    'tag without v prefix still compares',
    { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: '0.0.0' },
    1,
    '',
    /release tag 0\.0\.0 does not match version/,
  ],
]

for (const [name, extra, exit, stdout, stderr] of cases) {
  test(name, () => {
    const result = run(extra)
    assert.equal(result.status, exit, result.stderr)
    assert.equal(result.stdout, stdout)
    if (typeof stderr === 'string') assert.equal(result.stderr, stderr)
    else assert.match(result.stderr, stderr)
  })
}
