#!/usr/bin/env bun
// Version-consistency guard. Ponytail declares its version in eight files across
// six host ecosystems, and every release bumps all of them by hand.
//
// tests/gemini-extension.test.ts already checks the four plugin manifests agree
// with each other, but that can't catch the failure mode that shipped in v4.8.0:
// every manifest stayed stale at 4.7.0 *together* while the release moved on, so
// they "agreed" and the test passed (#260, #262). It also ignores the two
// package.json files. This check closes both gaps:
//   1. every version-bearing file must share one pinned X.Y.Z version, and
//   2. on a release-tag CI run, that shared version must equal the tag.

import fs from 'node:fs'

import path from 'node:path'
import { getGithubRefName, getGithubRefType } from '../hooks/ponytail-env.ts'

const root = path.join(import.meta.dirname, '..')
const PINNED_SEMVER = /^\d+\.\d+\.\d+$/
const BOM_RE = /^\uFEFF/
const LEADING_V_RE = /^v/

// Every file that declares the project version, and who reads it. Add new host
// manifests here so a future ecosystem can't drift unnoticed.
const VERSION_FILES = [
  '.claude-plugin/plugin.json', // Claude Code plugin — what users install
  '.codex-plugin/plugin.json', // Codex plugin
  '.devin-plugin/plugin.json', // Devin CLI plugin
  '.github/plugin/plugin.json', // Copilot plugin
  '.qoder-plugin/plugin.json', // Qoder plugin
  'gemini-extension.json', // Gemini CLI extension
  'package.json', // pi-package / repo root
  'plugin.yaml', // Hermes plugin
]
const YAML_VERSION_RE = /^version:\s*['"]?([^'"\s#]+)/m

function readVersion(relPath: string): unknown {
  try {
    // Strip a UTF-8 BOM some Windows editors prepend (breaks JSON.parse).
    const raw = fs.readFileSync(path.join(root, relPath), 'utf8').replace(BOM_RE, '')
    if (relPath.endsWith('.yaml')) {
      return YAML_VERSION_RE.exec(raw)?.[1]
    }
    const manifest: { version?: unknown } = JSON.parse(raw)
    return manifest.version
  } catch (e) {
    throw new Error(`${relPath}: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
  }
}

let failed = false
const versions = VERSION_FILES.map((relPath) => {
  const version = readVersion(relPath)
  if (typeof version !== 'string' || !PINNED_SEMVER.test(version)) {
    console.error(
      `${relPath}: version must be a pinned X.Y.Z semver, got ${JSON.stringify(version)}`,
    )
    failed = true
  }
  return [relPath, version]
})

// Every file must declare the same version.
const distinct = [...new Set(versions.map(([, v]) => v))]
if (distinct.length > 1) {
  console.error('Version mismatch — every manifest must share one version:')
  for (const [relPath, version] of versions) {
    console.error(`  ${version}\t${relPath}`)
  }
  failed = true
}
const shared = distinct.length === 1 ? distinct[0] : null

// On a release-tag push CI sets GITHUB_REF_TYPE=tag and GITHUB_REF_NAME=vX.Y.Z.
// The shared version must equal the tag — this catches tagging a release whose
// version files were never bumped, which mutual agreement alone cannot.
if (shared && getGithubRefType() === 'tag') {
  const tag = getGithubRefName() || ''
  const tagVersion = tag.replace(LEADING_V_RE, '')
  if (PINNED_SEMVER.test(tagVersion) && tagVersion !== shared) {
    console.error(
      `release tag ${tag} does not match version ${shared}; bump the version files before tagging`,
    )
    failed = true
  }
}

if (failed) {
  console.error('Align the version fields (see issue #260) so every manifest shares one version.')
  process.exit(1)
}

console.log(`All ${VERSION_FILES.length} version files pinned at ${shared}.`)
