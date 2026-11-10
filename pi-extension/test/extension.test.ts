import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import ponytailExtension, {
  type PiApi,
  type PiContext,
  parsePonytailCommand,
  type SystemPromptResult,
} from '../index.ts'

interface Entry {
  type: string
  customType: string
  data: { mode: string }
}

type Handler = (event: unknown, ctx: PiContext) => unknown

function createPiHarness() {
  const handlers = new Map<string, Handler>()
  const commands = new Map<string, Parameters<PiApi['registerCommand']>[1]>()
  const appendedEntries: { customType: string; data: { mode: string } }[] = []
  const sentUserMessages: { text: string; options: { expandPromptTemplates: boolean } }[] = []

  const pi: PiApi = {
    on(eventName: string, handler: (event: never, ctx: never) => unknown) {
      handlers.set(eventName, handler as Handler)
    },
    registerCommand(name, options) {
      commands.set(name, options)
    },
    appendEntry(customType, data) {
      appendedEntries.push({ customType, data })
    },
    sendUserMessage(text, options) {
      sentUserMessages.push({ text, options })
    },
  }

  ponytailExtension(pi)

  const fire = async (name: string, event: unknown, ctx: PiContext) => {
    const handler = handlers.get(name)
    assert.ok(handler, `handler ${name} is registered`)
    return await handler(event, ctx)
  }
  const beforeStart = async (event: unknown, ctx: PiContext) =>
    (await fire('before_agent_start', event, ctx)) as SystemPromptResult | undefined
  const command = (name: string) => {
    const found = commands.get(name)
    assert.ok(found, `command ${name} is registered`)
    return found
  }
  return { fire, beforeStart, command, commands, appendedEntries, sentUserMessages }
}

// Narrow a before_agent_start result: Pi hands a string prompt, OMP an array of parts.
function promptText(result: SystemPromptResult | undefined): string {
  assert.ok(result && typeof result.systemPrompt === 'string', 'expected a string systemPrompt')
  return result.systemPrompt
}

function promptParts(result: SystemPromptResult | undefined): string[] {
  assert.ok(result && Array.isArray(result.systemPrompt), 'expected an array systemPrompt')
  return result.systemPrompt
}

function createCommandContext(overrides: Partial<PiContext> = {}): PiContext {
  return {
    isIdle: () => true,
    sessionManager: { getEntries: () => [] },
    ui: { notify: () => undefined },
    ...overrides,
  }
}

function withTempConfig(fn: (home: string) => unknown) {
  const tempConfigHome = mkdtempSync(join(tmpdir(), 'ponytail-test-'))
  const previousXdg = process.env.XDG_CONFIG_HOME
  const previousHide = process.env.PONYTAIL_HIDE_STATUS
  const previousDefault = process.env.PONYTAIL_DEFAULT_MODE
  process.env.XDG_CONFIG_HOME = tempConfigHome
  delete process.env.PONYTAIL_HIDE_STATUS
  delete process.env.PONYTAIL_DEFAULT_MODE

  return Promise.resolve()
    .then(() => fn(tempConfigHome))
    .finally(() => {
      if (previousXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME
      } else {
        process.env.XDG_CONFIG_HOME = previousXdg
      }
      if (previousHide === undefined) {
        delete process.env.PONYTAIL_HIDE_STATUS
      } else {
        process.env.PONYTAIL_HIDE_STATUS = previousHide
      }
      if (previousDefault === undefined) {
        delete process.env.PONYTAIL_DEFAULT_MODE
      } else {
        process.env.PONYTAIL_DEFAULT_MODE = previousDefault
      }
      rmSync(tempConfigHome, { recursive: true, force: true })
    })
}

test('extension registers Ponytail commands', () => {
  const { commands } = createPiHarness()

  assert.deepEqual(
    [...commands.keys()].sort((a, b) => a.localeCompare(b)),
    [
      'ponytail',
      'ponytail-audit',
      'ponytail-debt',
      'ponytail-gain',
      'ponytail-help',
      'ponytail-review',
    ],
  )
})

test('/ponytail updates session mode and injects instructions', async () =>
  withTempConfig(async () => {
    const { fire, beforeStart, command, appendedEntries } = createPiHarness()
    const ctx = createCommandContext()

    await fire('session_start', { reason: 'startup' }, ctx)
    await command('ponytail').handler('ultra', ctx)

    assert.deepEqual(appendedEntries.at(-1), {
      customType: 'ponytail-mode',
      data: { mode: 'ultra' },
    })

    const result = await beforeStart({ systemPrompt: 'BASE' }, ctx)
    assert.ok(promptText(result).includes('PONYTAIL MODE ACTIVE'))
    assert.ok(promptText(result).includes('ultra'))
  }))

test('before_agent_start guards missing event and missing systemPrompt (#439, #440)', async () =>
  withTempConfig(async () => {
    const { fire, beforeStart } = createPiHarness()
    const ctx = createCommandContext()
    await fire('session_start', { reason: 'startup' }, ctx) // currentMode -> default (full)

    // #439: a null/undefined event must not crash, and still injects the ruleset.
    for (const bad of [undefined, null]) {
      const r = await beforeStart(bad, ctx)
      assert.ok(promptText(r).includes('PONYTAIL MODE ACTIVE'))
      assert.ok(!promptText(r).includes('undefined'), "must not contain the literal 'undefined'")
    }

    // #440: an event without a systemPrompt must not prepend the literal "undefined".
    const empty = await beforeStart({}, ctx)
    assert.ok(promptText(empty).includes('PONYTAIL MODE ACTIVE'))
    assert.ok(!promptText(empty).startsWith('undefined'), "must not start with 'undefined'")

    // A real base prompt is still preserved and prepended.
    const withBase = await beforeStart({ systemPrompt: 'BASE' }, ctx)
    assert.ok(promptText(withBase).startsWith('BASE\n\n'))
    assert.ok(promptText(withBase).includes('PONYTAIL MODE ACTIVE'))
  }))

test('before_agent_start keeps OMP prompt parts and uses Pi sections (#776, #953)', async () =>
  withTempConfig(async () => {
    const { fire, beforeStart, command } = createPiHarness()
    const ctx = createCommandContext()
    await fire('session_start', { reason: 'startup' }, ctx)

    // OMP: systemPrompt is an array of parts; they must stay separate, not comma-joined.
    const omp = await beforeStart({ systemPrompt: ['A', 'B'] }, ctx)
    assert.deepEqual(promptParts(omp).slice(0, 2), ['A', 'B'])
    assert.match(promptParts(omp)[2] ?? '', /PONYTAIL MODE ACTIVE/)

    // Pi >= 0.86: write a section and leave the prompt alone; off removes it again.
    const sections: Record<string, string> = {}
    const event = { systemPrompt: 'BASE', systemPromptOptions: { sections } }
    assert.equal(await beforeStart(event, ctx), undefined)
    assert.match(sections.ponytail ?? '', /PONYTAIL MODE ACTIVE/)
    await command('ponytail').handler('off', ctx)
    await beforeStart(event, ctx)
    assert.equal(sections.ponytail, undefined)
  }))

test('session_start restores latest persisted mode', async () =>
  withTempConfig(async () => {
    const { fire, beforeStart } = createPiHarness()
    const ctx = createCommandContext({
      sessionManager: {
        getEntries: () => [{ type: 'custom', customType: 'ponytail-mode', data: { mode: 'lite' } }],
      },
    })

    await fire('session_start', { reason: 'resume' }, ctx)
    const result = await beforeStart({ systemPrompt: 'BASE' }, ctx)

    assert.ok(promptText(result).includes('lite'))
  }))

test("session_tree restores the selected branch's mode without persisting it", async () =>
  withTempConfig(async () => {
    const { fire, beforeStart, command, appendedEntries } = createPiHarness()
    const lite: Entry = { type: 'custom', customType: 'ponytail-mode', data: { mode: 'lite' } }
    const off: Entry = { type: 'custom', customType: 'ponytail-mode', data: { mode: 'off' } }
    let branch: Entry[] = [lite, off]
    const statusWrites: (string | undefined)[] = []
    const notifications: string[] = []
    const ctx = createCommandContext({
      sessionManager: { getBranch: () => branch, getEntries: () => [lite, off] },
      ui: {
        notify: (text) => notifications.push(text),
        setStatus: (_key, text) => statusWrites.push(text),
        theme: { fg: (_color, text) => text },
      },
    })

    await fire('session_start', { reason: 'resume' }, ctx)
    await command('ponytail').handler('default ultra', ctx)
    assert.equal(await beforeStart({ systemPrompt: 'BASE' }, ctx), undefined)
    const notificationCount = notifications.length

    const cases: [Entry[], string][] = [
      [[lite], 'lite'],
      [[lite, off], 'off'],
      [[], 'ultra'],
    ]
    for (const [entries, mode] of cases) {
      branch = entries
      await fire('session_tree', { type: 'session_tree' }, ctx)
      const result = await beforeStart({ systemPrompt: 'BASE' }, ctx)
      const prompt = result === undefined ? undefined : promptText(result)
      const expectedPrefix = `BASE\n\nPONYTAIL MODE ACTIVE — level: ${mode}\n`
      const expectOff = mode === 'off'
      // Off yields no prompt and a cleared status bar; any other level yields its instructions.
      assert.equal(
        prompt?.startsWith(expectedPrefix) ?? 'off',
        expectOff ? 'off' : true,
        `expected ${mode} instructions`,
      )
      assert.equal(
        statusWrites.at(-1)?.includes(mode.toUpperCase()) ?? 'off',
        expectOff ? 'off' : true,
      )
    }

    assert.deepEqual(appendedEntries, [], 'navigation must not append a new mode entry')
    assert.equal(
      notifications.length,
      notificationCount,
      'navigation must not repeat the startup toast',
    )
  }))

test("OMP session_switch and session_branch restore the target session's mode", async () =>
  withTempConfig(async () => {
    // OMP keeps the legacy Pi events instead of re-emitting session_start on /new, /resume, /fork and /branch.
    const { fire, beforeStart, appendedEntries } = createPiHarness()
    const lite: Entry = { type: 'custom', customType: 'ponytail-mode', data: { mode: 'lite' } }
    const off: Entry = { type: 'custom', customType: 'ponytail-mode', data: { mode: 'off' } }
    let branch: Entry[] = [off]
    const ctx = createCommandContext({ sessionManager: { getBranch: () => branch } })

    await fire('session_start', { type: 'session_start' }, ctx)
    const cases: [string, Entry[], string][] = [
      ['session_switch', [lite], 'lite'],
      ['session_branch', [off], 'off'],
      ['session_switch', [], 'full'],
    ]
    for (const [type, entries, mode] of cases) {
      branch = entries
      await fire(type, { type }, ctx)
      const result = await beforeStart({ systemPrompt: ['BASE'] }, ctx)
      const last = result === undefined ? undefined : promptParts(result).at(-1)
      assert.equal(
        last?.startsWith(`PONYTAIL MODE ACTIVE — level: ${mode}\n`) ?? 'off',
        mode === 'off' ? 'off' : true,
        `${type} should restore ${mode}`,
      )
    }
    assert.deepEqual(appendedEntries, [], 'restoring must not append a new mode entry')
  }))

test('skill alias commands delegate to Pi skill commands', async () => {
  const { command, sentUserMessages } = createPiHarness()
  const ctx = createCommandContext()

  await command('ponytail-review').handler('', ctx)
  await command('ponytail-audit').handler('', ctx)
  await command('ponytail-debt').handler('', ctx)
  await command('ponytail-gain').handler('', ctx)
  await command('ponytail-help').handler('', ctx)

  assert.deepEqual(
    sentUserMessages.map((entry) => entry.text),
    [
      '/skill:ponytail-review',
      '/skill:ponytail-audit',
      '/skill:ponytail-debt',
      '/skill:ponytail-gain',
      '/skill:ponytail-help',
    ],
  )
})

test('skill alias commands expand the skill and forward their arguments', async () => {
  const { command, sentUserMessages } = createPiHarness()

  await command('ponytail-review').handler('staged', createCommandContext())
  await command('ponytail-audit').handler('src/api', createCommandContext({ isIdle: () => false }))

  assert.deepEqual(sentUserMessages, [
    { text: '/skill:ponytail-review staged', options: { expandPromptTemplates: true } },
    {
      text: '/skill:ponytail-audit src/api',
      options: { expandPromptTemplates: true, deliverAs: 'followUp' },
    },
  ])
})

test('normal mode disables persistent instructions', async () =>
  withTempConfig(async () => {
    const { fire, beforeStart, command } = createPiHarness()
    const ctx = createCommandContext()

    await fire('session_start', { reason: 'startup' }, ctx)
    await command('ponytail').handler('ultra', ctx)
    await fire('input', { text: 'normal mode', source: 'interactive' }, ctx)

    const disabled = await beforeStart({ systemPrompt: 'BASE' }, ctx)
    assert.equal(disabled, undefined)
  }))

test('a request mentioning normal mode stays active', async () =>
  withTempConfig(async () => {
    const { fire, beforeStart, command } = createPiHarness()
    const ctx = createCommandContext()

    await fire('session_start', { reason: 'startup' }, ctx)
    await command('ponytail').handler('ultra', ctx)
    await fire(
      'input',
      { text: 'add a normal mode toggle next to dark mode', source: 'interactive' },
      ctx,
    )

    const result = await beforeStart({ systemPrompt: 'BASE' }, ctx)
    assert.match(promptText(result), /PONYTAIL MODE ACTIVE/)
  }))

test('status bar renders the mode and flips active on agent_start', async () =>
  withTempConfig(async () => {
    const { fire } = createPiHarness()
    const statusWrites: { key: string; text: string | undefined }[] = []
    const ctx = createCommandContext({
      sessionManager: {
        getEntries: () => [
          { type: 'custom', customType: 'ponytail-mode', data: { mode: 'ultra' } },
        ],
      },
      ui: {
        notify: () => undefined,
        setStatus: (key, text) => statusWrites.push({ key, text }),
        theme: { fg: (_color, text) => text },
      },
    })

    await fire('session_start', { reason: 'resume' }, ctx)
    await fire('agent_start', {}, ctx)

    assert.equal(statusWrites.at(-2)?.key, 'ponytail')
    assert.match(statusWrites.at(-2)?.text ?? '', /○.*ULTRA/)
    assert.match(statusWrites.at(-1)?.text ?? '', /●.*ULTRA/)
  }))

test('off mode clears the status bar entry', async () =>
  withTempConfig(async () => {
    const { fire } = createPiHarness()
    const statusWrites: { key: string; text: string | undefined }[] = []
    const ctx = createCommandContext({
      sessionManager: {
        getEntries: () => [{ type: 'custom', customType: 'ponytail-mode', data: { mode: 'off' } }],
      },
      ui: {
        notify: () => undefined,
        setStatus: (key, text) => statusWrites.push({ key, text }),
        theme: { fg: (_color, text) => text },
      },
    })

    await fire('session_start', { reason: 'resume' }, ctx)

    assert.deepEqual(statusWrites.at(-1), { key: 'ponytail', text: undefined })
  }))

test('status bar stays silent when ui lacks a theme', async () =>
  withTempConfig(async () => {
    const { fire } = createPiHarness()
    const calls: (string | undefined)[] = []
    const ctx = createCommandContext({
      sessionManager: {
        getEntries: () => [
          { type: 'custom', customType: 'ponytail-mode', data: { mode: 'ultra' } },
        ],
      },
      ui: { notify: () => undefined, setStatus: (_key, text) => calls.push(text) }, // setStatus present, theme absent
    })

    await fire('session_start', { reason: 'resume' }, ctx)
    await fire('agent_start', {}, ctx)

    assert.deepEqual(calls, [])
  }))

test('PONYTAIL_HIDE_STATUS hides the indicator but keeps ponytail active (#324)', async () =>
  withTempConfig(async () => {
    process.env.PONYTAIL_HIDE_STATUS = '1'
    const { fire, beforeStart } = createPiHarness()
    const statusWrites: { key: string; text: string | undefined }[] = []
    const ctx = createCommandContext({
      sessionManager: {
        getEntries: () => [
          { type: 'custom', customType: 'ponytail-mode', data: { mode: 'ultra' } },
        ],
      },
      ui: {
        notify: () => undefined,
        setStatus: (key, text) => statusWrites.push({ key, text }),
        theme: { fg: (_c, t) => t },
      },
    })

    await fire('session_start', { reason: 'resume' }, ctx)
    await fire('agent_start', {}, ctx)
    const injected = await beforeStart({ systemPrompt: 'BASE' }, ctx)

    assert.deepEqual(statusWrites, [], 'status bar must not be drawn when hidden')
    assert.match(
      promptText(injected),
      /PONYTAIL MODE ACTIVE/,
      'ruleset must still inject while status is hidden',
    )
  }))

test('config.hideStatus hides the indicator but keeps ponytail active (#324)', async () =>
  withTempConfig(async (home) => {
    mkdirSync(join(home, 'ponytail'), { recursive: true })
    writeFileSync(join(home, 'ponytail', 'config.json'), JSON.stringify({ hideStatus: true }))
    const { fire, beforeStart } = createPiHarness()
    const statusWrites: { key: string; text: string | undefined }[] = []
    const ctx = createCommandContext({
      ui: {
        notify: () => undefined,
        setStatus: (key, text) => statusWrites.push({ key, text }),
        theme: { fg: (_c, t) => t },
      },
    })

    await fire('session_start', { reason: 'startup' }, ctx)
    await fire('agent_start', {}, ctx)
    const injected = await beforeStart({ systemPrompt: 'BASE' }, ctx)

    assert.deepEqual(statusWrites, [], 'config.hideStatus must suppress the status bar')
    assert.match(
      promptText(injected),
      /PONYTAIL MODE ACTIVE/,
      'ruleset must still inject while status is hidden',
    )
  }))

test('PONYTAIL_HIDE_STATUS=0 does not hide the indicator', async () =>
  withTempConfig(async () => {
    process.env.PONYTAIL_HIDE_STATUS = '0'
    const { fire } = createPiHarness()
    const statusWrites: { key: string; text: string | undefined }[] = []
    const ctx = createCommandContext({
      sessionManager: {
        getEntries: () => [
          { type: 'custom', customType: 'ponytail-mode', data: { mode: 'ultra' } },
        ],
      },
      ui: {
        notify: () => undefined,
        setStatus: (key, text) => statusWrites.push({ key, text }),
        theme: { fg: (_c, t) => t },
      },
    })

    await fire('session_start', { reason: 'resume' }, ctx)
    await fire('agent_start', {}, ctx)

    assert.ok(statusWrites.length > 0, "0 must be treated as 'do not hide'")
  }))

test('/ponytail autocompletes modes, commands and default <mode>', () => {
  const { command } = createPiHarness()
  const complete = (prefix: string) => command('ponytail').getArgumentCompletions?.(prefix) ?? null

  assert.deepEqual(
    complete('')?.map((item) => item.value),
    [
      'off',
      'lite',
      'full',
      'ultra',
      'status',
      'default off',
      'default lite',
      'default full',
      'default ultra',
    ],
  )
  assert.deepEqual(
    complete('fu')?.map((item) => item.value),
    ['full'],
  )
  assert.deepEqual(
    complete('default ')?.map((item) => item.value),
    ['default off', 'default lite', 'default full', 'default ultra'],
  )
  assert.deepEqual(
    complete('default l')?.map((item) => item.value),
    ['default lite'],
  )
  assert.deepEqual(
    complete('default')?.map((item) => item.value),
    ['default off', 'default lite', 'default full', 'default ultra'],
    'never a bare default: Enter would submit it without a mode',
  )
  assert.equal(complete('status x'), null, 'no command takes a second word after status')
  assert.equal(complete('lite x'), null)
  assert.equal(complete('bogus'), null, 'nothing matches an unknown prefix')
  for (const { value } of complete('') ?? []) {
    assert.notEqual(
      parsePonytailCommand(value).type,
      'invalid',
      `Enter on "${value}" must run a valid command`,
    )
  }
})
