// The OpenClaw skill package (.openclaw/skills/) is generated from skills/ by
// scripts/build-openclaw-skills.ts. These tests fail if the committed copies are
// stale (ruleset drift) or if a description breaks OpenClaw's one-line <160 rule.

import { test } from 'bun:test'

import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  DESCRIPTIONS,
  NAMES,
  outPath,
  render,
  sourceBody,
} from '../scripts/build-openclaw-skills.ts'

for (const name of NAMES) {
  test(`${name}: committed OpenClaw skill matches the generator`, () => {
    const onDisk = fs.readFileSync(outPath(name), 'utf8').replace(/\r\n/g, '\n')
    assert.equal(onDisk, render(name), 'stale — run: bun scripts/build-openclaw-skills.ts')
  })

  test(`${name}: body is the canonical skills/${name} body, verbatim`, () => {
    const onDisk = fs.readFileSync(outPath(name), 'utf8').replace(/\r\n/g, '\n')
    assert.ok(onDisk.endsWith(sourceBody(name)), `body drifted from skills/${name}`)
  })

  test(`${name}: description is one line under 160 chars`, () => {
    const d = DESCRIPTIONS[name] ?? ''
    assert.ok(d.length <= 160 && !d.includes('\n'), 'description too long or multiline')
  })
}
