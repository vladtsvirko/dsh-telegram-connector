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
  phase: 'draining' | 'accepted'
  from: string
  target: string
  /** Control chat and the editable status message. */
  chatId: number
  messageId?: number
}

/** The trial message that owns the Commit / Roll back buttons, so a later boot can retire it. */
export interface TrialMessageBinding {
  chatId: number
  messageId: number
  trialId: string
}

export interface Bindings {
  version: 2
  /** Private chat with the bot: the configuration surface. */
  controlChatId?: number
  /** Last confirmed Telegram update id, so a restart does not replay the queue. */
  lastUpdateId?: number
  /** The message whose buttons belong to the current trial, if one was announced. */
  trialMessage?: TrialMessageBinding
  /** Present while a setup update is draining/applying; cleared on the next boot. */
  update?: UpdateBinding
  /** IANA zone used to interpret user-typed times; display uses Telegram's own rendering. */
  timezone?: string
  /** Online overrides for the prompt/streaming reactions; config supplies defaults. */
  reactions?: StoredReactions
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

function isTrialMessage(value: unknown): value is TrialMessageBinding {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as { chatId?: unknown; messageId?: unknown; trialId?: unknown }
  return typeof candidate.chatId === 'number'
    && typeof candidate.messageId === 'number'
    && typeof candidate.trialId === 'string'
}

function isReactions(value: unknown): value is StoredReactions {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as { enabled?: unknown; read?: unknown; streaming?: unknown }
  return (candidate.enabled === undefined || typeof candidate.enabled === 'boolean')
    && (candidate.read === undefined || typeof candidate.read === 'string')
    && (candidate.streaming === undefined || typeof candidate.streaming === 'string')
}

export function sessionKey(chatId: number, threadId: number): string {
  return `${chatId}:${threadId}`
}

export function bindingsPath(dshHome: string): string {
  return `${dshHome.replace(/\/+$/, '')}/telegram-connector/bindings.json`
}

export async function loadBindings(file: string): Promise<Bindings> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<Bindings>
    if (parsed.version !== 2) return structuredClone(EMPTY)
    return {
      version: 2,
      ...(typeof parsed.controlChatId === 'number' ? { controlChatId: parsed.controlChatId } : {}),
      ...(typeof parsed.lastUpdateId === 'number' ? { lastUpdateId: parsed.lastUpdateId } : {}),
      ...(isTrialMessage(parsed.trialMessage) ? { trialMessage: parsed.trialMessage } : {}),
      ...(isUpdate(parsed.update) ? { update: parsed.update } : {}),
      ...(typeof parsed.timezone === 'string' ? { timezone: parsed.timezone } : {}),
      ...(isReactions(parsed.reactions) ? { reactions: parsed.reactions } : {}),
      workspaces: parsed.workspaces ?? {},
      sessions: parsed.sessions ?? {},
    }
  } catch {
    return structuredClone(EMPTY)
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
