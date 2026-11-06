/**
 * Integration harness for the connector itself.
 *
 * Every other test in this directory covers a pure helper module. This one boots
 * the real `apply()` from `src/index.ts` with a fake Cordis context and a fake
 * Telegram Bot API, so message delivery can be observed end to end:
 *
 *   fake update → real routing/handlers → fake fetch → assertions on the calls
 *
 * There is no network, no real session log, and no real agent. The fake services
 * are deliberately small: they implement exactly the surface `apply()` touches
 * (`agents.create/resume/list/get`, the optional `workspaceRegistry`, and a
 * no-op `sessions`) and nothing else.
 *
 * ## Bindings
 *
 * The plugin loads `bindings.json` from `$DSH_HOME/telegram-connector/bindings.json`
 * (`bindingsPath()` in `src/bindings.ts`). The harness points `DSH_HOME` at a
 * fresh temp dir and writes that file *before* boot. This is the robust route:
 * it does not depend on polling, slash routing, or the order in which updates
 * arrive. Tests that need an incoming update still push one through the fake
 * `getUpdates` queue with `pushUpdate()`.
 *
 * ## Time
 *
 * Real timers only. `editIntervalMs` is 20ms so a streamed flush happens almost
 * immediately; `waitFor` polls every 10ms with a 3s default deadline. The
 * connector's own per-chat rate limiter is not configurable from the plugin
 * config (BotPool defaults to one send every 1.1s), so a test that triggers
 * several sends can take ~2s. Per-test timeouts are raised accordingly.
 *
 * @module tests/harness
 */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { apply, type ConnectorConfig } from '../src/index.js'
import type { Bindings } from '../src/bindings.js'
import type { TgMessage, TgUpdate } from '../src/telegram.js'

export const BOT_TOKEN = 'test:token'
export const USER_ID = 42
export const CHAT_ID = -1001234567890
export const THREAD_ID = 7
export const WORKSPACE_ID = 'ws-test'
export const SESSION_ID = 'sess-test-1'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** One Bot API call observed by the fake `fetch`. */
export interface TgCall {
  method: string
  params: Record<string, any>
  url: string
  at: number
  /** The message id Telegram returned for a send/edit, when it returned one. */
  messageId?: number
}

/** The text a send/edit call carries, whichever transport it used. */
export function callText(call: TgCall): string {
  const text = call.params.text
  if (typeof text === 'string') return text
  const rich = call.params.rich_message as { markdown?: unknown } | undefined
  return typeof rich?.markdown === 'string' ? rich.markdown : ''
}

/** Poll `predicate` until it returns a truthy value; throws after `timeoutMs`. */
export async function waitFor<T>(
  predicate: () => T | false | null | undefined | Promise<T | false | null | undefined>,
  label = 'condition',
  timeoutMs = 3000,
): Promise<T> {
  const started = Date.now()
  for (;;) {
    // Awaited on purpose: an async predicate is the natural way to wait for a
    // file to appear, and treating its Promise as truthy returns at once.
    const value = await predicate()
    if (value) return value
    if (Date.now() - started >= timeoutMs) {
      throw new Error(`waitFor(${label}) timed out after ${timeoutMs}ms`)
    }
    await sleep(10)
  }
}

// ---------------------------------------------------------------------------
// Fake Telegram Bot API
// ---------------------------------------------------------------------------

interface FakeTelegram {
  calls: TgCall[]
  sent: TgCall[]
  edited: TgCall[]
  answered: TgCall[]
  updates: TgUpdate[]
  restore: () => void
}

/** A refusal the way Telegram sends one: HTTP 400 and an `ok:false` envelope. */
function jsonError(description: string, errorCode = 400): Response {
  return new Response(JSON.stringify({ ok: false, error_code: errorCode, description }), {
    status: errorCode,
    headers: { 'content-type': 'application/json' },
  })
}

function json(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Replace `globalThis.fetch`. Every call is recorded, including methods the
 * plugin did not wrap explicitly: unknown methods answer `{ok:true,result:true}`
 * rather than throwing, so a future plugin call cannot make the harness lie.
 */
function installFakeTelegram(
  initialUpdates: TgUpdate[] = [],
  failSend?: (call: TgCall) => string | undefined,
): FakeTelegram {
  const originalFetch = globalThis.fetch
  const calls: TgCall[] = []
  const sent: TgCall[] = []
  const edited: TgCall[] = []
  const answered: TgCall[] = []
  const updates = [...initialUpdates]
  let nextMessageId = 1000
  let nextThreadId = 500

  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url
    const method = url.split('/').pop() ?? ''
    const rawBody = typeof init?.body === 'string' ? init.body : '{}'
    let params: Record<string, any> = {}
    try {
      params = JSON.parse(rawBody) as Record<string, any>
    } catch {
      params = {}
    }
    const call: TgCall = { method, params, url, at: Date.now() }
    calls.push(call)
    // A test can make a send fail the way Telegram does, without a real network.
    const refusal = failSend?.(call)
    if (refusal !== undefined) return jsonError(refusal)

    switch (method) {
      case 'getMe':
        return json({ id: 9001, is_bot: true, first_name: 'Test Bot', username: 'test_bot' })
      case 'getUpdates': {
        // A real long poll blocks. Sleeping here keeps the plugin's loop from
        // becoming a busy spin and gives dispose() a chance to observe `stopped`.
        if (updates.length === 0) await sleep(25)
        return json(updates.splice(0, updates.length))
      }
      case 'sendMessage':
      case 'sendRichMessage': {
        sent.push(call)
        call.messageId = nextMessageId++
        return json({
          message_id: call.messageId,
          chat: { id: params.chat_id, type: 'supergroup' },
          date: Math.floor(Date.now() / 1000),
        })
      }
      case 'editMessageText': {
        edited.push(call)
        call.messageId = params.message_id as number
        return json({
          message_id: params.message_id,
          chat: { id: params.chat_id, type: 'supergroup' },
          date: Math.floor(Date.now() / 1000),
        })
      }
      case 'answerCallbackQuery':
        answered.push(call)
        return json(true)
      case 'createForumTopic':
        return json({ message_thread_id: nextThreadId++, name: params.name })
      case 'getChat':
        return json({ id: params.chat_id, type: 'supergroup', title: 'Test Workspace', is_forum: true })
      case 'getChatMember':
        return json({ status: 'member', user: { id: params.user_id } })
      case 'getFile':
        return json({ file_id: params.file_id, file_unique_id: 'unique', file_path: 'file.bin' })
      // Cosmetic or one-shot methods the connector may call. They are recorded
      // above and succeed with Telegram's usual boolean result.
      case 'setMyCommands':
      case 'deleteMessage':
      case 'setMessageReaction':
      case 'sendChatAction':
      case 'editForumTopic':
      case 'deleteForumTopic':
      case 'closeForumTopic':
      case 'reopenForumTopic':
      case 'setChatTitle':
        return json(true)
      default:
        return json(true)
    }
  }

  globalThis.fetch = fakeFetch as typeof fetch

  return {
    calls,
    sent,
    edited,
    answered,
    updates,
    restore: () => {
      globalThis.fetch = originalFetch
    },
  }
}

// ---------------------------------------------------------------------------
// Fake Cordis services
// ---------------------------------------------------------------------------

export interface FakeAgentSession {
  id: string
  sessionId: string
  workspaceId: string
  cwd: string
  header: { id: string; agentPreset?: string }
}

export interface FakeAgent {
  id: string
  status: 'idle' | 'running'
  session: FakeAgentSession
  followups: Array<{ content: any[]; source?: { kind?: string } }>
  disposed: boolean
  followup(message: { content: any[]; source?: { kind?: string } }): void
}

/** The subset of `agents` that `apply()` actually calls. */
export class FakeAgents {
  readonly created: FakeAgent[] = []
  readonly createRequests: Array<Record<string, any>> = []
  readonly resumeRequests: Array<Record<string, any>> = []
  failCreateWith: Error | undefined
  failResumeWith: Error | undefined

  list(): FakeAgent[] {
    return this.created
  }

  get(id: unknown): FakeAgent | undefined {
    return this.created.find((agent) => String(agent.session.id) === String(id))
  }

  async create(options: Record<string, any>): Promise<{ agent: FakeAgent; dispose: () => Promise<void> }> {
    this.createRequests.push(options)
    if (this.failCreateWith !== undefined) throw this.failCreateWith
    return this.spawn(String(options.sessionId), String(options.meta?.cwd ?? ''))
  }

  async resume(options: Record<string, any>): Promise<{ agent: FakeAgent; dispose: () => Promise<void> }> {
    this.resumeRequests.push(options)
    if (this.failResumeWith !== undefined) throw this.failResumeWith
    return this.spawn(String(options.resumeSessionId), String(options.meta?.cwd ?? ''))
  }

  private spawn(id: string, cwd: string): { agent: FakeAgent; dispose: () => Promise<void> } {
    const agent: FakeAgent = {
      id,
      status: 'idle',
      session: {
        id,
        sessionId: id,
        workspaceId: WORKSPACE_ID,
        cwd,
        header: { id },
      },
      followups: [],
      disposed: false,
      followup(message) {
        agent.followups.push(message)
      },
    }
    this.created.push(agent)
    return {
      agent,
      dispose: async () => {
        agent.disposed = true
      },
    }
  }
}

/** `sessions` is in `inject` but the current implementation does not call it. */
export class FakeSessions {
  get(): undefined {
    return undefined
  }

  create(): never {
    throw new Error('FakeSessions.create is not implemented: the connector does not call it')
  }

  readSession(): undefined {
    return undefined
  }

  list(): [] {
    return []
  }
}

/** The subset of `workspaceRegistry` used by `ensureAgent` and reconciliation. */
export class FakeRegistry {
  /** Sessions attached to the primary workspace; kept for the older tests. */
  readonly attached: string[] = []
  readonly archivedSessionIds: string[] = []
  /** Set by forgetWorkspace(): the runtime lost the registration, bindings did not. */
  private forgotten = false
  private restoredId = 'ws-restored'
  private nextId = 0
  private readonly extra = new Map<string, { path: string; title: string; sessionIds: string[] }>()

  constructor(
    public workspaceId: string,
    public path: string,
  ) {}

  /** Simulate a registry that no longer lists this workspace. */
  forgetWorkspace(): void {
    this.forgotten = true
    this.attached.length = 0
  }

  list(): Array<{ id: string; path: string; title: string; sessionIds: string[] }> {
    const rows: Array<{ id: string; path: string; title: string; sessionIds: string[] }> = []
    if (!this.forgotten) {
      rows.push({ id: this.workspaceId, path: this.path, title: 'Test Workspace', sessionIds: [...this.attached] })
    }
    for (const [id, entry] of this.extra) rows.push({ id, path: entry.path, title: entry.title, sessionIds: [...entry.sessionIds] })
    return rows
  }

  get(id: string): {
    id: string
    path: string
    sessionIds: string[]
    attachSession: (sessionId: string) => Promise<void>
  } | undefined {
    const view = (workspaceId: string, path: string, sessionIds: string[]): {
      id: string
      path: string
      sessionIds: string[]
      attachSession: (sessionId: string) => Promise<void>
    } => ({
      id: workspaceId,
      path,
      sessionIds,
      attachSession: async (sessionId: string) => {
        sessionIds.push(sessionId)
      },
    })
    if (!this.forgotten && id === this.workspaceId) return view(id, this.path, this.attached)
    const entry = this.extra.get(id)
    if (entry !== undefined) return view(id, entry.path, entry.sessionIds)
    return undefined
  }

  async resolveByPath(path: string): Promise<{ id: string } | undefined> {
    if (!this.forgotten && path === this.path) return this.get(this.workspaceId)
    for (const [id, entry] of this.extra) if (entry.path === path) return this.get(id)
    return undefined
  }

  /**
   * Recreate a registration. A lost *primary* comes back under a new id (the
   * real registry never reuses one); a path the fake has not seen becomes its
   * own workspace, so a second group's workspace does not collapse into the
   * first — which is what the binding tests assert about.
   */
  async create(path: string, title?: string): Promise<{ id: string; path: string; sessionIds: string[]; attachSession: (sessionId: string) => Promise<void> }> {
    if (this.forgotten && path === this.path) {
      this.forgotten = false
      this.workspaceId = this.restoredId
      const restored = this.get(this.workspaceId)
      if (restored === undefined) throw new Error('FakeRegistry.create: cannot materialize the restored registration')
      return restored
    }
    const id = `ws-new-${++this.nextId}`
    this.extra.set(id, { path, title: title ?? 'Restored Workspace', sessionIds: [] })
    const created = this.get(id)
    if (created === undefined) throw new Error('FakeRegistry.create: cannot materialize a new registration')
    return created
  }

  async archiveSession(sessionId: string): Promise<void> {
    this.archivedSessionIds.push(sessionId)
  }

  async unarchiveSession(sessionId: string): Promise<void> {
    const index = this.archivedSessionIds.indexOf(sessionId)
    if (index >= 0) this.archivedSessionIds.splice(index, 1)
  }
}

type Handler = (...args: any[]) => unknown

/**
 * A Cordis `Context` stand-in.
 *
 * Only the surface `apply()` uses is implemented: `on`, `logger`, `effect`,
 * `get`, and the injected `agents`/`sessions` properties. Handlers are recorded
 * so tests can emit `session/event` and `agent/error` directly.
 */
export class FakeContext {
  readonly handlers = new Map<string, Handler[]>()
  readonly loggerLines: string[] = []
  readonly logger = {
    info: (line: string): void => {
      this.loggerLines.push(`info ${line}`)
    },
    warn: (line: string): void => {
      this.loggerLines.push(`warn ${line}`)
    },
    debug: (line: string): void => {
      this.loggerLines.push(`debug ${line}`)
    },
    error: (line: string): void => {
      this.loggerLines.push(`error ${line}`)
    },
  }

  readonly services: Record<string, unknown>
  readonly agents: FakeAgents
  readonly sessions: FakeSessions
  private readonly disposers: Array<() => unknown> = []
  private readonly handlerErrors: unknown[] = []

  constructor(services: Record<string, unknown>, agents: FakeAgents, sessions: FakeSessions) {
    this.services = services
    this.agents = agents
    this.sessions = sessions
  }

  on(event: string, handler: Handler): () => void {
    const list = this.handlers.get(event) ?? []
    list.push(handler)
    this.handlers.set(event, list)
    return () => {
      const current = this.handlers.get(event) ?? []
      const index = current.indexOf(handler)
      if (index >= 0) current.splice(index, 1)
    }
  }

  effect(fn: () => (() => unknown) | void): () => void {
    const cleanup = fn()
    if (typeof cleanup === 'function') this.disposers.push(cleanup)
    return () => {
      const index = this.disposers.indexOf(cleanup as () => unknown)
      if (index >= 0) this.disposers.splice(index, 1)
      if (typeof cleanup === 'function') cleanup()
    }
  }

  get(name: string): unknown {
    return this.services[name]
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      try {
        const result = handler(...args)
        if (result instanceof Promise) {
          result.catch((error: unknown) => this.handlerErrors.push(error))
        }
      } catch (error) {
        this.handlerErrors.push(error)
      }
    }
  }

  /** Run the cleanup returned by every `ctx.effect` (the plugin's `stop()`). */
  disposeEffects(): void {
    for (const cleanup of [...this.disposers].reverse()) {
      try {
        cleanup()
      } catch {
        // a failing cleanup must not hide the test's own failure
      }
    }
    this.disposers.length = 0
  }

  get errors(): readonly unknown[] {
    return this.handlerErrors
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

/** The default workspace/topic binding every delivery test starts from. */
export function makeBindings(workspaceRoot: string): Bindings {
  return {
    version: 2,
    workspaces: {
      [WORKSPACE_ID]: {
        chatId: CHAT_ID,
        path: workspaceRoot,
        title: 'Test Workspace',
      },
    },
    sessions: {
      [`${CHAT_ID}:${THREAD_ID}`]: {
        workspaceId: WORKSPACE_ID,
        sessionId: SESSION_ID,
        title: 'Test Session',
      },
    },
  }
}

export interface BootOptions {
  /** Directory for `DSH_HOME`, bindings, journals and the outbox. */
  dir?: string
  /** Override the bindings written before boot (defaults to `makeBindings`). */
  bindings?: Bindings
  /** Incoming updates queued before the poll loop starts. */
  updates?: TgUpdate[]
  /** Fail a Bot API call: return Telegram's description, or undefined to allow it. */
  failSend?: (call: TgCall) => string | undefined
  /** Make the fake agent service refuse `create`/`resume`. */
  agent?: {
    failCreateWith?: Error
    failResumeWith?: Error
  }
  /** A registry prepared before boot (e.g. one that forgot its workspace). */
  registry?: FakeRegistry
  /** Extra host services (pluginManager, hmr, commands, …) for one test. */
  services?: Record<string, unknown>
  /** Environment variables to set for the boot (e.g. supervisor credentials). */
  env?: Record<string, string>
  /** Data root (the parent of DSH_HOME) and the instance id this process is. */
  dataRoot?: string
  instanceId?: string
}

export interface IncomingMessageOptions {
  text: string
  userId?: number
  chatId?: number
  threadId?: number
  messageId?: number
  updateId?: number
  extra?: Partial<TgMessage>
}

export interface Harness {
  ctx: FakeContext
  calls: TgCall[]
  sent: TgCall[]
  edited: TgCall[]
  answered: TgCall[]
  agents: FakeAgents
  sessions: FakeSessions
  registry: FakeRegistry
  dir: string
  workspaceRoot: string
  bindingsFile: string
  config: ConnectorConfig
  emitSessionEvent(session: unknown, event: unknown): void
  emitAgentError(agent: unknown, error: unknown): void
  pushUpdate(update: TgUpdate): void
  makeUpdate(options: IncomingMessageOptions): TgUpdate
  waitFor<T>(predicate: () => T | false | null | undefined, label?: string, timeoutMs?: number): Promise<T>
  dispose(): Promise<void>
}

const ENV_KEYS = [
  'DSH_HOME',
  'DSH_DATA_ROOT',
  'DSH_INSTANCE_ID',
  'DSH_TELEGRAM_PUBLISHER_TOKENS',
  'DSH_SUPERVISOR_URL',
  'DSH_SUPERVISOR_TOKEN',
] as const

/**
 * Boot the real plugin.
 *
 * `configOverrides` is merged over the deterministic defaults. The fake context
 * is passed to `apply()` exactly as Cordis would; no part of `apply()` is
 * stubbed or replaced.
 */
export async function boot(
  configOverrides: Partial<ConnectorConfig> = {},
  options: BootOptions = {},
): Promise<Harness> {
  const dir = options.dir ?? await mkdtemp(join(tmpdir(), 'dsh-telegram-harness-'))
  const workspaceRoot = configOverrides.workspaceRoot ?? join(dir, 'workspace')
  await mkdir(workspaceRoot, { recursive: true })

  const bindingsFile = join(dir, 'telegram-connector', 'bindings.json')
  await mkdir(join(dir, 'telegram-connector'), { recursive: true })
  const bindings = options.bindings ?? makeBindings(workspaceRoot)
  await writeFile(bindingsFile, `${JSON.stringify(bindings, null, 2)}\n`)

  const savedEnv = new Map<string, string | undefined>()
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key])
  if (options.dataRoot !== undefined) process.env.DSH_DATA_ROOT = options.dataRoot
  if (options.instanceId !== undefined) process.env.DSH_INSTANCE_ID = options.instanceId
  const restoreEnv = (): void => {
    for (const key of ENV_KEYS) {
      const value = savedEnv.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  process.env.DSH_HOME = dir
  process.env.DSH_TELEGRAM_PUBLISHER_TOKENS = ''
  process.env.DSH_SUPERVISOR_URL = ''
  process.env.DSH_SUPERVISOR_TOKEN = ''
  for (const [key, value] of Object.entries(options.env ?? {})) process.env[key] = value

  const telegram = installFakeTelegram(options.updates, options.failSend)
  const agents = new FakeAgents()
  agents.failCreateWith = options.agent?.failCreateWith
  agents.failResumeWith = options.agent?.failResumeWith
  const sessions = new FakeSessions()
  const registry = options.registry ?? new FakeRegistry(WORKSPACE_ID, workspaceRoot)
  const ctx = new FakeContext(
    { agents, sessions, workspaceRegistry: registry, ...options.services },
    agents,
    sessions,
  )

  const config: ConnectorConfig = {
    botToken: BOT_TOKEN,
    allowedUserIds: [USER_ID],
    workspaceRoot,
    editIntervalMs: 20,
    pollTimeoutSeconds: 1,
    reconcileIntervalSeconds: 0,
    processMode: 'live',
    // Reactions are cosmetic and add unrelated fetch calls; tests that care
    // about them can turn them back on through `configOverrides`.
    reactionsEnabled: false,
    ...configOverrides,
  }

  try {
    apply(ctx as unknown as Context, config)

    // `start()` is fire-and-forget inside ctx.effect. getUpdates is only reached
    // after loadBindings, bridge.start and outbox.start have completed, so it is
    // the readiness signal for the whole boot.
    await waitFor(
      () => telegram.calls.some((call) => call.method === 'getUpdates'),
      'connector boot (getUpdates)',
      3000,
    )
  } catch (error) {
    // Do not leak the fake fetch or the temp DSH_HOME into the next test.
    telegram.restore()
    restoreEnv()
    throw error
  }

  let nextUpdateId = 1
  let nextMessageId = 1
  let disposed = false

  const harness: Harness = {
    ctx,
    calls: telegram.calls,
    sent: telegram.sent,
    edited: telegram.edited,
    answered: telegram.answered,
    agents,
    sessions,
    registry,
    dir,
    workspaceRoot,
    bindingsFile,
    config,
    emitSessionEvent(session, event) {
      ctx.emit('session/event', session, event)
    },
    emitAgentError(agent, error) {
      ctx.emit('agent/error', { agent, error })
    },
    pushUpdate(update) {
      telegram.updates.push(update)
    },
    makeUpdate(input) {
      const updateId = input.updateId ?? nextUpdateId++
      const message: TgMessage = {
        message_id: input.messageId ?? nextMessageId++,
        date: Math.floor(Date.now() / 1000),
        chat: {
          id: input.chatId ?? CHAT_ID,
          type: 'supergroup',
          title: 'Test Workspace',
          is_forum: true,
        },
        from: {
          id: input.userId ?? USER_ID,
          is_bot: false,
          first_name: 'Tester',
          username: 'tester',
        },
        text: input.text,
        is_topic_message: true,
        message_thread_id: input.threadId ?? THREAD_ID,
        ...input.extra,
      }
      return { update_id: updateId, message }
    },
    waitFor(predicate, label = 'condition', timeoutMs = 3000) {
      return waitFor(predicate, label, timeoutMs)
    },
    async dispose() {
      if (disposed) return
      disposed = true
      ctx.disposeEffects()
      // stop() is fire-and-forget in the plugin's effect cleanup. Give it a
      // moment to drain the outbox and persist before the fake fetch goes away;
      // tests wait for the sends they trigger, so this is normally one tick.
      await sleep(150)
      telegram.restore()
      restoreEnv()
    },
  }

  return harness
}
