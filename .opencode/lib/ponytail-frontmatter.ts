// ponytail command-file and SKILL.md frontmatter parser.
//
// Kept outside plugins/ so the plugin module's only top-level export is
// the plugin definition itself. OpenCode's legacy plugin loader (the one that
// runs before v1 plugins are detected) treats every function exported from a
// plugin module as a plugin; calling the frontmatter parser as one threw
// "path must be a string or a file descriptor" because it got the plugin
// context object as its first argument. Keeping the parser in its own module
// leaves exactly one plugin-shaped export in the plugin module.

import fs from 'node:fs'

const COMMAND_FILE_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/
const SKILL_FILE_RE = /^---\r?\n([\s\S]*?)\r?\n---[^\S\n]*\r?\n?([\s\S]*)$/
const DESCRIPTION_RE = /description:\s*(.+)/
const LINE_BREAK_RE = /\r?\n/
const INDENTED_RE = /^\s/

interface CommandFile {
  description: string | undefined
  template: string
}

interface SkillFile {
  name: string | undefined
  description: string | undefined
  body: string
}

function parseCommandFile(filePath: string): CommandFile | null {
  const content = fs.readFileSync(filePath, 'utf8')
  // Tolerate CRLF: a Windows checkout (autocrlf) delivers \r\n, npm ships \n.
  const match = content.match(COMMAND_FILE_RE)
  if (!match) {
    return null
  }
  const description = match[1]?.match(DESCRIPTION_RE)?.[1]?.trim()
  return { description, template: (match[2] ?? '').trim() }
}

// ponytail: flat frontmatter only — the shape every shipped SKILL.md uses. A
// nested key or an anchor is not interpreted, and a real YAML parser is the
// upgrade path if a skill ever needs one.
function frontmatterField(frontmatter: string, key: string): string | undefined {
  const lines = frontmatter.split(LINE_BREAK_RE)
  const at = lines.findIndex((line) => line.startsWith(`${key}:`))
  if (at === -1) {
    return
  }
  const value = (lines[at] ?? '').slice(key.length + 1).trim()
  if (!(value.startsWith('>') || value.startsWith('|'))) {
    return value
  }

  // Block scalar: `>` folds the lines into one, `|` keeps them. Indented lines
  // continue the block, the next unindented key ends it (skills/ponytail has
  // `argument-hint` after its description), and a trailing `-` drops the
  // newline YAML would otherwise close the scalar with.
  const block: string[] = []
  for (const line of lines.slice(at + 1)) {
    if (line.trim() && !INDENTED_RE.test(line)) {
      break
    }
    block.push(line.trim())
  }
  while (block.length && !block.at(-1)) {
    block.pop()
  }
  const joined = block.join(value.startsWith('|') ? '\n' : ' ')
  return value.endsWith('-') ? joined : `${joined}\n`
}

// OpenCode's V2 skill transform takes the resolved fields, not the file: the
// skill id is the directory name, and `content` is the body with its
// frontmatter stripped. Matches what OpenCode itself derives from a discovered
// .opencode/skills/<id>/SKILL.md.
function parseSkillFile(filePath: string): SkillFile | null {
  const content = fs.readFileSync(filePath, 'utf8')
  const match = content.match(SKILL_FILE_RE)
  if (!match) {
    return null
  }
  const frontmatter = match[1] ?? ''
  return {
    name: frontmatterField(frontmatter, 'name'),
    description: frontmatterField(frontmatter, 'description'),
    body: match[2] ?? '',
  }
}

export { parseCommandFile, parseSkillFile }
