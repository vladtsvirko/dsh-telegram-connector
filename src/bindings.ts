/**
 * Durable two-level bindings: workspace ↔ group, session ↔ topic.
 *
 * The shape follows DSH's own containment: a workspace owns its sessions. A
 * Telegram group stands for a workspace, and each forum topic inside it stands
 * for one session.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { StoredReactions } from './reactions.js'

export interface ModelChoice {
  provider?: string
  model?: string
}

/** A DSH workspace that is represented by one Telegram group. */
export interface WorkspaceBinding {
  /** Telegram group id. */
  chatId: number
  path: string
  title: string
  /** The topic that owns commands; absent means the General topic. */
  systemThreadId?: number
  /**
   * Topic ids this group has shown us. Telegram has no "list topics" method, so
   * this is the only inventory a bot can have — cleanup works from it.
   */
  seenThreads?: number[]
}

/** One topic inside a workspace group, standing for one DSH session. */
export interface SessionBinding {
  workspaceId: string
  /** DSH session id; minted when the topic is created, adopted by the agent. */
  sessionId: string
  model?: ModelChoice
  /** Cached topic title, so a rename can be attributed to the user or to us. */
  title?: string
}

/** A setup update that was requested and has not finished booting yet. */
export interface UpdateBinding {
  /** Short id carried by the Cancel button. */
  id: string
  startedAt: number
  mode: 'compatible' | 'available'
  phase: 'pending' | 'cross' | 'draining' | 'accepted'
  from: string
  target: string
  /** Set when the target crosses a DSH line or a product major. */
  crosses?: boolean
  /** The operator explicitly accepted an incompatible jump. */
  crossConfirmed?: boolean
  dshFrom?: string
  dshTo?: string
  /** Commit subjects between the two tags, for the confirmation card. */
  commits?: string[]
  /** Control chat and the editable status message. */
  chatId: number
  messageId?: number
}

/** The control-center widget that is currently current; a new one replaces it. */
export interface PanelMessageBinding {
  chatId: number
  messageId: number
}

/** The trial message that owns the Commit / Roll back buttons, so a later boot can retire it. */
export interface TrialMessageBinding {
  chatId: number
  messageId: number
  trialId: string
}

/** A live process card that must be closed if the connector restarts mid-turn. */
export interface ProcessCardBinding {
  chatId: number
  threadId: number
  messageId: number
  /** The card was sent as a rich message and must be edited the same way. */
  rich: boolean
}

export interface Bindings {
  version: 2
  /** Private chat with the bot: the configuration surface. */
  controlChatId?: number
  /** Last confirmed Telegram update id, so a restart does not replay the queue. */
  lastUpdateId?: number
  /** The message whose buttons belong to the current trial, if one was announced. */
  trialMessage?: TrialMessageBinding
  /** The newest control-center widget, so /start does not leave a trail of stale cards. */
  panelMessage?: PanelMessageBinding
  /** Present while a setup update is draining/applying; cleared on the next boot. */
  update?: UpdateBinding
  /** IANA zone used to interpret user-typed times; display uses Telegram's own rendering. */
  timezone?: string
  /** Online overrides for the prompt/streaming reactions; config supplies defaults. */
  reactions?: StoredReactions
  /** sessionId → live process card that a restart should close. */
  processCards?: Record<string, ProcessCardBinding>
  /** workspaceId → group */
  workspaces: Record<string, WorkspaceBinding>
  /** `${chatId}:${threadId}` → session */
  sessions: Record<string, SessionBinding>
}

const EMPTY: Bindings = { version: 2, workspaces: {}, sessions: {} }

function isUpdate(value: unknown): value is UpdateBinding {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as {
    id?: unknown; startedAt?: unknown; mode?: unknown; phase?: unknown
    from?: unknown; target?: unknown; chatId?: unknown; messageId?: unknown
  }
  return typeof candidate.id === 'string'
    && typeof candidate.startedAt === 'number'
    && (candidate.mode === 'compatible' || candidate.mode === 'available')
    && (candidate.phase === 'draining' || candidate.phase === 'accepted')
    && typeof candidate.from === 'string'
    && typeof candidate.target === 'string'
    && typeof candidate.chatId === 'number'
    && (candidate.messageId === undefined || typeof candidate.messageId === 'number')
}

function isPanelMessage(value: unknown): value is PanelMessageBinding {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as { chatId?: unknown; messageId?: unknown }
  return typeof candidate.chatId === 'number' && typeof candidate.messageId === 'number'
}

function isTrialMessage(value: unknown): value is TrialMessageBinding {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as { chatId?: unknown; messageId?: unknown; trialId?: unknown }
  return typeof candidate.chatId === 'number'
    && typeof candidate.messageId === 'number'
    && typeof candidate.trialId === 'string'
}

function isProcessCards(value: unknown): value is Record<string, ProcessCardBinding> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value as Record<string, unknown>).every((entry) => {
    if (entry === null || typeof entry !== 'object') return false
    const card = entry as { chatId?: unknown; threadId?: unknown; messageId?: unknown; rich?: unknown }
    return typeof card.chatId === 'number'
      && typeof card.threadId === 'number'
      && typeof card.messageId === 'number'
      && typeof card.rich === 'boolean'
  })
}

function isReactions(value: unknown): value is StoredReactions {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as { enabled?: unknown; read?: unknown; streaming?: unknown; staged?: unknown }
  return (candidate.enabled === undefined || typeof candidate.enabled === 'boolean')
    && (candidate.read === undefined || typeof candidate.read === 'string')
    && (candidate.streaming === undefined || typeof candidate.streaming === 'string')
    && (candidate.staged === undefined || typeof candidate.staged === 'string')
}

export function sessionKey(chatId: number, threadId: number): string {
  return `${chatId}:${threadId}`
}

export function bindingsPath(dshHome: string): string {
  return `${dshHome.replace(/\/+$/, '')}/telegram-connector/bindings.json`
}

/**
 * Load the topic↔session map.
 *
 * A file that exists but cannot be used is kept aside and reported through
 * `warn`: starting empty is recoverable (one /sync), starting empty *silently*
 * is not — the user loses every topic binding without knowing why.
 */
export async function loadBindings(file: string, warn?: (line: string) => void): Promise<Bindings> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    // First boot has no file; any other read failure is worth naming.
    if ((error as { code?: unknown }).code !== 'ENOENT') {
      console.error(`dsh-telegram-connector: cannot read ${file}: ${String(error)}`)
    }
    return structuredClone(EMPTY)
  }
  const keep = async (suffix: string, reason: string): Promise<Bindings> => {
    // A corrupt or older file used to be replaced by an empty document and then
    // overwritten on the next save — every binding gone, silently. Keep it.
    const backup = `${file}.${suffix}-${String(Date.now())}`
    await rename(file, backup).catch(() => undefined)
    const line = `${file} ${reason}; kept it as ${backup} and started empty`
    console.error(`dsh-telegram-connector: ${line}`)
    warn?.(line)
    return structuredClone(EMPTY)
  }
  let parsed: Partial<Bindings>
  try {
    parsed = JSON.parse(raw) as Partial<Bindings>
  } catch (error) {
    return keep('corrupt', `is not valid JSON (${String(error)})`)
  }
  if (parsed.version !== 2) return keep(`v${String(parsed.version)}`, `is version ${String(parsed.version)}, expected 2`)
  return {
    version: 2,
    ...(typeof parsed.controlChatId === 'number' ? { controlChatId: parsed.controlChatId } : {}),
    ...(typeof parsed.lastUpdateId === 'number' ? { lastUpdateId: parsed.lastUpdateId } : {}),
    ...(isTrialMessage(parsed.trialMessage) ? { trialMessage: parsed.trialMessage } : {}),
    ...(isPanelMessage(parsed.panelMessage) ? { panelMessage: parsed.panelMessage } : {}),
    ...(isUpdate(parsed.update) ? { update: parsed.update } : {}),
    ...(typeof parsed.timezone === 'string' ? { timezone: parsed.timezone } : {}),
    ...(isReactions(parsed.reactions) ? { reactions: parsed.reactions } : {}),
    ...(isProcessCards(parsed.processCards) ? { processCards: parsed.processCards } : {}),
    workspaces: parsed.workspaces ?? {},
    sessions: parsed.sessions ?? {},
  }
}

/**
 * Atomic replace with a durable temp file. The temp name is unique per call:
 * two overlapping writers must never share it, or the loser's rename can
 * resurrect an older snapshot.
 */
export async function saveBindings(file: string, bindings: Bindings): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
  const handle = await open(temp, 'w', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(bindings, null, 2)}\n`)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temp, file)
}

export function workspaceByChat(bindings: Bindings, chatId: number): WorkspaceBinding | undefined {
  return Object.values(bindings.workspaces).find((workspace) => workspace.chatId === chatId)
}

export function workspaceIdByChat(bindings: Bindings, chatId: number): string | undefined {
  return Object.entries(bindings.workspaces).find(([, workspace]) => workspace.chatId === chatId)?.[0]
}

/** Find a workspace by id, exact title, path basename or a unique prefix of the id. */
export function findWorkspace(bindings: Bindings, needle: string): [string, WorkspaceBinding] | undefined {
  const query = needle.trim().toLowerCase()
  if (query.length === 0) return undefined
  const entries = Object.entries(bindings.workspaces)
  return (
    entries.find(([id, workspace]) =>
      id.toLowerCase() === query ||
      id.toLowerCase().startsWith(query) ||
      workspace.title.toLowerCase() === query ||
      workspace.path.toLowerCase() === query ||
      workspace.path.toLowerCase().endsWith(`/${query}`)
    )
  )
}

export function sessionFor(bindings: Bindings, chatId: number, threadId: number): SessionBinding | undefined {
  return bindings.sessions[sessionKey(chatId, threadId)]
}

export function setSession(
  bindings: Bindings,
  chatId: number,
  threadId: number,
  session: SessionBinding,
): void {
  bindings.sessions[sessionKey(chatId, threadId)] = session
}

export function removeSession(bindings: Bindings, chatId: number, threadId: number): void {
  delete bindings.sessions[sessionKey(chatId, threadId)]
}

/** Topics belonging to one workspace group, as `[threadId, session]` pairs. */
export function sessionsOfChat(bindings: Bindings, chatId: number): Array<[number, SessionBinding]> {
  return Object.entries(bindings.sessions)
    .filter(([key]) => key.startsWith(`${chatId}:`))
    .map(([key, session]) => [Number(key.slice(key.indexOf(':') + 1)), session] as [number, SessionBinding])
}
