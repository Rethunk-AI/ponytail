// Shared Ponytail instruction builder for Claude hooks and Pi extension.

import fs from 'node:fs'

import path from 'node:path'
import { DEFAULT_MODE, normalizeMode } from './ponytail-config.ts'

const FRONTMATTER_RE = /^---[\s\S]*?---\s*/
const LINE_BREAK_RE = /\r?\n/
const TABLE_LABEL_RE = /^\|\s*\*\*(.+?)\*\*\s*\|/
const EXAMPLE_LABEL_RE = /^-\s*([^:]+):\s*"/
const SKILL_PATH = path.join(import.meta.dirname, '..', 'skills', 'ponytail', 'SKILL.md')

function filterSkillBodyForMode(body: unknown, mode: unknown): string {
  const effectiveMode = normalizeMode(mode) || DEFAULT_MODE
  const withoutFrontmatter = String(body || '').replace(FRONTMATTER_RE, '')

  // Only the intensity table rows and worked examples are mode-specific, and
  // both are keyed by a mode name (lite/full/ultra). A bullet whose label is
  // not a mode — e.g. "No unrequested abstractions: ..." — is a normal rule
  // and must be kept verbatim.
  return withoutFrontmatter
    .split(LINE_BREAK_RE)
    .filter((line) => {
      const tableLabel = TABLE_LABEL_RE.exec(line)
      if (tableLabel) {
        const labelMode = normalizeMode(tableLabel[1]?.trim())
        if (labelMode) {
          return labelMode === effectiveMode
        }
      }

      // Require a quoted value: every worked example is `- lite: "..."`. Without
      // this, an ordinary rule bullet that happens to start with a mode word
      // (e.g. "- Full: ...") is silently dropped in every other mode — it looks
      // like a worked example but is really prose meant to survive verbatim.
      const exampleLabel = EXAMPLE_LABEL_RE.exec(line)
      if (exampleLabel) {
        const labelMode = normalizeMode(exampleLabel[1]?.trim())
        if (labelMode) {
          return labelMode === effectiveMode
        }
      }

      return true
    })
    .join('\n')
}

function getPonytailInstructions(mode: unknown): string {
  const effectiveMode = normalizeMode(mode) || DEFAULT_MODE

  try {
    return (
      'PONYTAIL MODE ACTIVE — level: ' +
      effectiveMode +
      '\n\n' +
      filterSkillBodyForMode(fs.readFileSync(SKILL_PATH, 'utf8'), effectiveMode)
    )
  } catch {
    return `PONYTAIL MODE ACTIVE — level: ${effectiveMode}. The ruleset (skills/ponytail/SKILL.md) could not be read: reinstall ponytail.`
  }
}

export { filterSkillBodyForMode, getPonytailInstructions }
