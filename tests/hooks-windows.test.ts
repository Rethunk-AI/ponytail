// Regression test for issues #19 and #593: on Windows the lifecycle hooks run
// via PowerShell, so the shared `command` field must be cross-platform (plain
// `bun`, no bash-only syntax). commandWindows is not part of the supported
// hooks schema on the Claude.ai plugin marketplace validator, so it is omitted
// — plain `bun -e "..."` works everywhere without relying on shell-specific
// variable syntax (see #824: the command text used to embed a
// ${CLAUDE_PLUGIN_ROOT} placeholder that the *host* substitutes textually
// before the shell parses the command, which is unsafe if the substituted
// value carries shell metacharacters — the fixed command instead reads
// process.env.CLAUDE_PLUGIN_ROOT from inside the runtime, so the shell never
// re-parses the plugin root at all).
//
// The hook also has to point at a script that actually ships in hooks/.

import { test } from 'bun:test'

import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = path.join(import.meta.dirname, '..')
const HOOKS_JSON = 'hooks/claude-codex-hooks.json'
const COPILOT_HOOKS_JSON = 'hooks/copilot-hooks.json'
const HOST_PLUGIN_MANIFESTS = ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']
// PowerShell 5.1 rejects these POSIX shell guards when a host runs `command`.
const POSIX_GUARD_SYNTAX = /\bcommand\s+-v\b|&&|\|\||>\/dev\/null|2>&1/
// Pull the hooks/<script> a command launches, so we can check it exists.
const HOOK_SCRIPT = /hooks[\\/]([\w.-]+\.(?:ts|ps1|sh))/
// #824: a plugin-root placeholder textually interpolated into shell command
// text is unsafe — the host substitutes it before the shell parses the
// command, so a hostile install path can break out of the quoting.
const PLUGIN_ROOT_PLACEHOLDER = /\$\{(?:CLAUDE_)?PLUGIN_ROOT\}/

// Read inside each case so a missing/malformed file fails as a clean assertion,
// not a load-time crash.
interface CommandHook {
  command?: string
  commandWindows?: unknown
}

function commandHooks(): CommandHook[] {
  const config: { hooks: Record<string, { hooks: CommandHook[] }[]> } = JSON.parse(
    fs.readFileSync(path.join(root, HOOKS_JSON), 'utf8'),
  )
  return Object.values(config.hooks)
    .flat()
    .flatMap((entry) => entry.hooks)
}

function copilotCommands(): (string | undefined)[] {
  const config: { hooks: Record<string, { bash?: string; powershell?: string }[]> } = JSON.parse(
    fs.readFileSync(path.join(root, COPILOT_HOOKS_JSON), 'utf8'),
  )
  return Object.values(config.hooks)
    .flat()
    .flatMap((entry) => [entry.bash, entry.powershell])
}

// commandWindows is not part of the supported hooks schema on the Claude.ai
// plugin marketplace validator (#593). Since the shared `command` field
// already runs cross-platform (plain `node -e "..."`, no shell-specific
// syntax, and VS Code Copilot ignores commandWindows and runs `command`
// through PowerShell on Windows anyway), it is omitted.
test('hooks.json omits commandWindows for marketplace validation (#593)', () => {
  for (const hook of commandHooks()) {
    assert.equal(
      hook.commandWindows,
      undefined,
      `hook must not use commandWindows (not supported by marketplace validator): ${hook.command}`,
    )
  }
})

test('shared hook commands avoid POSIX-only guard syntax', () => {
  const commands = commandHooks().flatMap((h) => (h.command ? [h.command] : []))
  assert.ok(commands.length > 0, 'expected at least one shared command entry')
  for (const cmd of commands) {
    assert.doesNotMatch(cmd, POSIX_GUARD_SYNTAX, `command uses POSIX-only guard syntax: ${cmd}`)
  }
})

// Issue #527 / #569: the shared `command` field must be shell-agnostic. `exec`
// is a bash/zsh builtin with no PowerShell equivalent, but some hosts run
// `command` through PowerShell on Windows regardless of the commandWindows
// field — VS Code Copilot always does (it never reads commandWindows), and
// native Claude Code launched from Git Bash was seen doing the same. `exec
// bun ...` then dies on its first token with CommandNotFoundException, so
// every hook fails on Windows. Plain `bun ...` runs natively in both bash and
// PowerShell. The wrapper-process pileup that #461 originally used `exec` to
// avoid is handled separately by each hook's stdin self-exit guard (#443/#477).
test('shared hook commands are shell-agnostic (no bash-only exec prefix)', () => {
  const commands = commandHooks().flatMap((h) => (h.command ? [h.command] : []))
  assert.ok(commands.length > 0, 'expected at least one shared command entry')
  for (const cmd of commands) {
    assert.doesNotMatch(
      cmd,
      /(^|\s)exec\s/,
      `command must not use the bash-only 'exec' builtin (breaks under PowerShell): ${cmd}`,
    )
    assert.match(
      cmd,
      /^bun\s+/,
      `command must invoke bun directly so it runs in both bash and PowerShell: ${cmd}`,
    )
    assert.doesNotMatch(
      cmd,
      /;\s*exit 0$/,
      `command must not leave a shell wrapper waiting on node: ${cmd}`,
    )
  }
})

test('every hook command points at a script that ships in hooks/', () => {
  for (const hook of commandHooks()) {
    const cmd = hook.command ?? ''
    const name = HOOK_SCRIPT.exec(cmd)?.[1]
    assert.ok(name, `cannot find a hooks/ script in command: ${cmd}`)
    assert.ok(
      fs.existsSync(path.join(root, 'hooks', name)),
      `command references a missing hook script: ${name}`,
    )
  }
})

// Issue #443: on Windows the UserPromptSubmit hook runs inside a PowerShell
// `if {}` wrapper that can swallow the piped prompt JSON, so stdin 'end' never
// fires. The hook must never wait on stdin forever — that freezes the whole
// session. It has to self-exit even when stdin stays open and empty. The
// activate hook reads the SessionStart source from stdin too.
for (const script of ['ponytail-mode-tracker.ts', 'ponytail-activate.ts']) {
  test(`${script} self-exits when stdin never closes (no freeze)`, async () => {
    const hook = path.join(root, 'hooks', script)
    // A throwaway home: the activate fallback writes the flag.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-stdin-'))
    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    }
    // stdin is a pipe we never write to or end, reproducing the deadlock.
    const child = spawn(process.execPath, [hook], { env, stdio: ['pipe', 'ignore', 'ignore'] })

    const code = await new Promise<number | null>((resolve, reject) => {
      const guard = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error('hook hung on open stdin — it would freeze the session'))
      }, 3000)
      child.on('exit', (c) => {
        clearTimeout(guard)
        resolve(c)
      })
      child.on('error', reject)
    })
    fs.rmSync(home, { recursive: true, force: true })

    assert.equal(code, 0, 'hook must exit cleanly when stdin never closes')
  })
}

test('Claude and Codex manifests point at the shared host-specific hook config', () => {
  const expected: Record<string, string | string[]> = {
    '.claude-plugin/plugin.json': [`./${HOOKS_JSON}`],
    '.codex-plugin/plugin.json': `./${HOOKS_JSON}`,
  }
  for (const rel of HOST_PLUGIN_MANIFESTS) {
    const manifest: { hooks?: unknown } = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'))
    assert.deepEqual(
      manifest.hooks,
      expected[rel],
      `${rel} must not rely on root hooks auto-discovery`,
    )
  }
})

// #824: lifecycle hook commands must not interpolate the plugin-root
// placeholder into shell text — a host that substitutes it textually before
// the shell parses the command lets a hostile install path break out of the
// quoting. Commands must instead have the invoked script read the root from
// its own process.env.
test('claude-codex-hooks.json commands contain no plugin-root placeholder', () => {
  const commands = commandHooks().flatMap((h) => (h.command ? [h.command] : []))
  assert.ok(commands.length > 0, 'expected at least one shared command entry')
  for (const cmd of commands) {
    assert.doesNotMatch(
      cmd,
      PLUGIN_ROOT_PLACEHOLDER,
      `command interpolates the plugin root into shell text: ${cmd}`,
    )
  }
})

test('copilot-hooks.json commands contain no plugin-root placeholder', () => {
  const commands = copilotCommands().filter((c): c is string => Boolean(c))
  assert.ok(commands.length > 0, 'expected at least one copilot command entry')
  for (const cmd of commands) {
    assert.doesNotMatch(
      cmd,
      PLUGIN_ROOT_PLACEHOLDER,
      `command interpolates the plugin root into shell text: ${cmd}`,
    )
  }
})

// End-to-end proof for #824. The reported mechanism is specifically a HOST
// that textually substitutes a ${CLAUDE_PLUGIN_ROOT}/${PLUGIN_ROOT}
// placeholder into the command STRING itself before a shell parses it — a
// real shell's own quoted ${VAR} expansion is safe (no re-parsing inside
// double quotes), so invoking the raw command with the env var merely SET
// does not reproduce the bug. This test instead performs that host-style
// substitution explicitly, matching the threat model in the issue: before
// the fix this created MARKER; after the fix there is no placeholder left to
// substitute, so the hostile value never reaches shell text at all.
test('a hostile plugin root cannot inject shell commands via host-side textual substitution (#824)', () => {
  const isWindows = process.platform === 'win32'
  const commands = [...commandHooks().map((h) => h.command), ...copilotCommands()].filter(
    (c): c is string => Boolean(c),
  )
  assert.ok(commands.length > 0, 'expected at least one command to check')

  const marker = path.join(os.tmpdir(), `ponytail-824-marker-${process.pid}`)
  const hostileRoot = isWindows
    ? `C:\\x" ; New-Item -ItemType File -Path "${marker}" ; "`
    : `/tmp/x"; touch "${marker}"; echo "`

  for (const cmd of commands) {
    fs.rmSync(marker, { force: true })
    const substituted = cmd
      .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, hostileRoot)
      .replace(/\$\{PLUGIN_ROOT\}/g, hostileRoot)
    try {
      if (isWindows) {
        execFileSync('powershell', ['-NoProfile', '-Command', substituted], { stdio: 'ignore' })
      } else {
        execFileSync('bash', ['-c', substituted], { stdio: 'ignore' })
      }
    } catch {
      // Expected to fail (resolves to a bogus module path) — only whether
      // MARKER was created matters.
    }
    assert.equal(
      fs.existsSync(marker),
      false,
      `hostile plugin root injected shell commands via: ${cmd}`,
    )
  }
  fs.rmSync(marker, { force: true })
})

// Hooks run with the project as cwd, and bun reads ./bunfig.toml before the
// script starts, so a cloned repo's `preload` would run on every prompt.
test('a project bunfig.toml preload does not run inside the hooks', () => {
  const isWindows = process.platform === 'win32'
  const commands = [
    ...commandHooks().map((h) => h.command),
    ...copilotCommands().filter((c) => c && (isWindows ? !c.startsWith('bun') : c.startsWith('bun'))),
  ].filter((c): c is string => Boolean(c))
  assert.ok(commands.length > 0, 'expected at least one command to check')

  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-bunfig-'))
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-bunfig-home-'))
  const marker = path.join(project, 'preload-ran')
  fs.writeFileSync(path.join(project, 'bunfig.toml'), 'preload = ["./evil.ts"]\n')
  fs.writeFileSync(
    path.join(project, 'evil.ts'),
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, '')\n`,
  )
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    CLAUDE_PLUGIN_ROOT: root,
    PLUGIN_ROOT: root,
  }
  try {
    for (const cmd of commands) {
      fs.rmSync(marker, { force: true })
      const [shell, flag] = isWindows ? ['powershell', '-Command'] : ['bash', '-c']
      execFileSync(shell, [flag, cmd], { cwd: project, env, stdio: 'ignore' })
      assert.equal(fs.existsSync(marker), false, `project preload ran via: ${cmd}`)
    }
  } finally {
    fs.rmSync(project, { recursive: true, force: true })
    fs.rmSync(home, { recursive: true, force: true })
  }
})
