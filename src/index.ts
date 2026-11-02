/**
 * dsh-telegram-connector — a Telegram control plane for DeepSeek Harness.
 *
 * The mapping follows DSH's own containment hierarchy:
 *
 *   private chat with the bot   the control plane (workspaces, plugins, schedules)
 *   group                       one workspace
 *   topic inside that group     one session
 *   General topic               the workspace dashboard
 *
 * @module dsh-telegram-connector
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'

import { TelegramClient, TelegramApiError, isRichRejected, type TgCallbackQuery, type TgMessage } from './telegram.js'
import { splitMessage, toPlainText, toRichMarkdown, toTelegramHtml } from './render.js'
import { installTelegramPrompt, registerTelegramSkill } from './telegram-prompt.js'
import {
  attachmentPlaceholder,
  formatBytes,
  isImageMediaType,
  MAX_TELEGRAM_DOWNLOAD,
  mediaDescriptor,
  stagedKey,
  type MediaDescriptor,
} from './media.js'
import {
  formatForwardedReference,
  forwardedReference,
  mediaReplyPrompt,
  referenceOf,
  referencePrompt,
  type ForwardedReference,
  type ReplyReference,
} from './reference.js'
import {
  allowedReactionsText,
  describeReactions,
  parseReactionValue,
  resolveReactions,
  type ReactionSettings,
} from './reactions.js'
import { createTopicWorkspace } from './sessions.js'
import {
  describeBundle,
  describeBundleList,
  describeChange,
  describeInspection,
  localized,
  type BundleInfo,
  type ChangeResult,
  type Inspection,
  type PluginManagerService,
} from './plugins.js'
import { SupervisorClient, deadlineText, parseTrialCallback, trialCallbackData, type SupervisorStatus } from './supervisor.js'
import { hasHelpFlag, indexText, lookupText, manualText, stripHelpFlag, unknownHelp, type Surface } from './help.js'
import { resolveTimeZone, validTimeZone } from './time.js'
import { connectorVersion, runtimeVersion } from './about.js'
import { BotPool, type BotHandle } from './bots.js'
import { Outbox, type ItemPriority, type OutboxItem } from './outbox.js'
import { SessionBridge, type TurnRecord } from './bridge.js'
import { claimsTopic, isForeignPrompt, MirrorQueue, messageText, promptText } from './mirror.js'
import { isOwnershipError, OWNERSHIP_HINT } from './errors.js'
import {
  commandLabel,
  formatLiveProcess,
  formatProcessSummary,
  formatProcessSummaryText,
  redactPreview,
  redactSecrets,
  skillLabel,
  toolLabel,
  type ProcessItem,
} from './process.js'
import {
  isReservedConnectorCommand,
  normalizeSlashInput,
  parseSlash,
  unescapeLeadingSlash,
} from './slash.js'
import {
  bindingsPath,
  findWorkspace,
  loadBindings,
  removeSession,
  saveBindings,
  sessionFor,
  sessionKey,
  sessionsOfChat,
  setSession,
  workspaceByChat,
  workspaceIdByChat,
  type Bindings,
  type SessionBinding,
  type WorkspaceBinding,
} from './bindings.js'

export const name = 'dsh-telegram-connector'
export const inject = ['agents', 'sessions']

export const Config = Schema.object({
  botToken: Schema.string().default(''),
  allowedUserIds: Schema.array(Schema.number()).default([]),
  workspaceRoot: Schema.string().default(''),
  provider: Schema.string(),
  model: Schema.string(),
  editIntervalMs: Schema.number().default(1200),
  pollTimeoutSeconds: Schema.number().default(25),
  reconcileIntervalSeconds: Schema.number().default(60),
  processMode: Schema.union(['off', 'summary', 'live']).default('live'),
  agentPreset: Schema.string(),
  reactionsEnabled: Schema.boolean().default(true),
  readReaction: Schema.string().default('👀'),
  streamingReaction: Schema.string().default('✍'),
  stagedReaction: Schema.string().default('🙉'),
})

export interface ConnectorConfig {
  botToken: string
  allowedUserIds: number[]
  workspaceRoot?: string
  provider?: string
  model?: string
  editIntervalMs?: number
  pollTimeoutSeconds?: number
  reconcileIntervalSeconds?: number
  /**
   * `off` hides process rows; `summary` sends one collapsed summary per turn;
   * `live` edits a process card during the turn and finalises it collapsed.
   */
  processMode?: 'off' | 'summary' | 'live'
  agentPreset?: string
  reactionsEnabled?: boolean
  readReaction?: string
  streamingReaction?: string
  stagedReaction?: string
}

/** The narrow surface of DSH's agentPresets service used by this plugin. */
interface AgentPresetService {
  readonly defaultId: string
  resolve(id?: string): Promise<{ id: string; broken?: unknown }>
  mount(ctx: Context, id: string): Promise<unknown>
}

/** The subset of dsh-commands used by the Telegram slash bridge. */
interface HostCommandDescriptor {
  name: string
  description?: string
  input?: { hint?: string }
}

interface HostCommandService {
  list(agent: Agent): readonly HostCommandDescriptor[]
  execute(
    agent: Agent,
    line: string,
    attachments: readonly unknown[],
    signal: AbortSignal,
  ): Promise<{ result: { kind: 'success' | 'error'; text?: string } } | undefined>
}

/** The subset of dsh-skill's registry used to list user-invocable skills. */
interface SkillSummaryView {
  name: string
  description?: string
  invocation?: { userInvocable?: boolean }
}

interface SkillListService {
  list(options: { cwd?: string }): Promise<readonly SkillSummaryView[]>
}

interface WorkspaceView {
  workspaceId: string
  path: string
  title: string
  sessionIds: string[]
}

interface WorkspaceController {
  create(request: { path: string }): Promise<{ workspace: WorkspaceView; created: boolean }>
  rename(request: { workspaceId: string; title: string }): Promise<unknown>
  delete(request: { workspaceId: string }): Promise<unknown>
  /** Adopt a session into a workspace's navigation list (and optional order). */
  insertSessionBefore(request: {
    workspaceId: string
    sessionId: string
    beforeSessionId?: string
  }): Promise<unknown>
}

interface RegistryEntry {
  id: string
  path: string
  title: string
  sessionIds?: string[]
}

interface RegistryWorkspace {
  id: string
  path: string
  sessionIds: string[]
  /** Adopt a session: validates its stored cwd against this workspace's path. */
  attachSession(sessionId: string): Promise<void>
}

interface WorkspaceRegistry {
  list(): RegistryEntry[]
  get(workspaceId: string): RegistryWorkspace | undefined
  readonly archivedSessionIds: string[]
  archiveSession(sessionId: string, options?: { stopActivity?: boolean }): Promise<void>
  unarchiveSession(sessionId: string): Promise<void>
}

/**
 * Optional host services.
 *
 * Cordis installs an access guard on the context proxy: reading
 * `ctx.workspaceRegistry` throws unless the service is in `inject`, even when it
 * is simply absent from this composition. `ctx.get()` is the unguarded accessor
 * and returns `undefined` instead, which is what an optional dependency needs.
 */
function serviceOf<T>(ctx: Context, name: string): T | undefined {
  try {
    return (ctx as unknown as { get(name: string): unknown }).get(name) as T | undefined
  } catch {
    return undefined
  }
}

function controllerOf(ctx: Context): WorkspaceController | undefined {
  return serviceOf<WorkspaceController>(ctx, 'workspaceController')
}

function registryOf(ctx: Context): WorkspaceRegistry | undefined {
  return serviceOf<WorkspaceRegistry>(ctx, 'workspaceRegistry')
}

interface TopicRuntime {
  chatId: number
  threadId: number
  workspace: WorkspaceBinding
  session: SessionBinding
  agent?: Agent
  /**
   * Set when another client (a web UI tab) takes the session's write handle.
   * Until the next prompt this plugin lands, the topic mirrors that client
   * instead of streaming into a handle it no longer owns.
   */
  foreign?: boolean
  dispose?: () => Promise<void>
  buffer: string
  parts: number[]
  /** Parallel to `parts`: whether that message was sent as a rich message. */
  partRich: boolean[]
  /** Sticky transport choice for this stream; once rich fails, stay on HTML. */
  richMode?: 'rich' | 'html'
  /** Messages carrying the streaming reaction; cleared when the turn settles. */
  reactionParts: Map<number, { bot: BotHandle; pending: Promise<void> }>
  /** Serializes flushes so a timer and a turn end cannot send the same chunk twice. */
  flushChain?: Promise<void>
  /** Last buffer that was delivered completely; avoids a redundant final edit. */
  lastFlushed?: string
  flushTimer?: NodeJS.Timeout
  /** Whether the session has been attached to its workspace. */
  attached?: boolean
  /** Bot that sent this turn's message; edits must come from the same bot. */
  bot?: BotHandle
  /** Prompt that started this turn, kept for the bridge journal. */
  lastPrompt?: string
  /** Journaled turn waiting for its first message to be acknowledged. */
  pendingTurnId?: string
  /** Safe tool/command/skill rows for the current turn; summarized at turn end. */
  process: ProcessItem[]
  /** True between turn/start and turn/end; stray events outside a turn are ignored. */
  processActive?: boolean
  /** Editable live card for this turn; absent in `summary`/`off` mode. */
  processCard?: ProcessCardState
}

/** One editable process message, shared by Telegram turns and Web mirrors. */
interface ProcessCardState {
  chatId: number
  threadId: number
  sessionId: string
  messageId?: number
  rich: boolean
  timer?: NodeJS.Timeout
  chain: Promise<void>
  lastTouched: number
}

/** One media message waiting for a caption or a following text prompt. */
interface StagedMedia extends MediaDescriptor {
  chatId: number
  threadId: number
  userId: number
  messageId: number
  createdAt: number
}

interface PendingGroupItem {
  message: TgMessage
  media: MediaDescriptor
}

interface PendingMediaGroup {
  key: string
  chatId: number
  threadId: number
  userId: number
  groupId: string
  items: PendingGroupItem[]
  timer?: NodeJS.Timeout
}

/** The narrow surface of DSH's attachment service used for Telegram media. */
interface AttachmentStoreLike {
  saveImage(input: { data: Uint8Array; mediaType: string; name?: string }): Promise<unknown>
  saveFile(input: { data: Uint8Array; name?: string }): Promise<unknown>
}

const STARTGROUP_PREFIX = 'workspace_'

function truncate(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1)}…`
}

export function apply(ctx: Context, config: ConnectorConfig): void {
  if (config.botToken.length === 0) {
    ctx.logger.warn('dsh-telegram-connector: botToken is empty; the connector will not start')
    return
  }

  const agentPresetService = (): AgentPresetService | undefined => {
    const get = (ctx as unknown as { get?: (name: string) => unknown }).get
    return typeof get === 'function' ? (get.call(ctx, 'agentPresets') as AgentPresetService | undefined) : undefined
  }

  const client = new TelegramClient(config.botToken)
  const agents = ctx.agents

  // Publisher bots are send-only; the main bot stays the only poller. Tokens come
  // from the environment so they never land in the profile patch.
  const publisherTokens = (process.env.DSH_TELEGRAM_PUBLISHER_TOKENS ?? '')
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && token !== config.botToken)
  const botHandles: BotHandle[] = [
    { label: 'main', client, main: true },
    ...publisherTokens.map((token, index) => ({
      label: `publisher ${index + 1}`,
      client: new TelegramClient(token),
      main: false,
    })),
  ]
  const botPool = new BotPool(botHandles)
  const supervisorUrl = process.env.DSH_SUPERVISOR_URL ?? ''
  const supervisorToken = process.env.DSH_SUPERVISOR_TOKEN ?? ''
  // Both come from the container entrypoint; without them this runtime cannot
  // restart itself, and the commands say so instead of failing obscurely.
  const supervisor = supervisorUrl.length > 0 && supervisorToken.length > 0
    ? new SupervisorClient(supervisorUrl, supervisorToken)
    : undefined
  const logger = ctx.logger
  const editIntervalMs = config.editIntervalMs ?? 1200
  const pollTimeoutSeconds = config.pollTimeoutSeconds ?? 25
  const reconcileIntervalMs = (config.reconcileIntervalSeconds ?? 60) * 1000
  const dshHome = process.env.DSH_HOME ?? process.env.HOME ?? process.cwd()
  // DSH_WORKSPACE is the directory the runtime itself works in (set by the image);
  // falling back to $DSH_HOME/workspace puts user files in the state volume
  const workspaceRoot = config.workspaceRoot !== undefined && config.workspaceRoot.length > 0
    ? config.workspaceRoot
    : (process.env.DSH_WORKSPACE ?? join(dshHome, 'workspace'))
  const file = bindingsPath(dshHome)

  const runtimes = new Map<string, TopicRuntime>()
  /** Topic names seen at creation, applied to the session when its agent starts. */
  const topicTitles = new Map<number, string>()
  /** Prompts injected from Telegram, so their user/message event is not mirrored back. */
  const injected = new Map<string, number>()
  let bindings: Bindings = { version: 2, workspaces: {}, sessions: {} }
  let offset = 0
  let stopped = false
  let lastErrorAt = 0
  let reconcileTimer: NodeJS.Timeout | undefined
  let reconciling = false
  let botUsername: string | undefined
  const reminded = new Set<string>()
  let staleUpdateBatch = false
  const staleUpdateNotified = new Set<number>()
  let drainState: { mode: 'compatible' | 'available'; startedAt: number; blockers: string[] } | undefined
  const blockedNotified = new Map<number, number>()
  const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
  const updaterToken = process.env.DSH_UPDATER_TOKEN ?? ''
  const updaterUrl = (process.env.DSH_UPDATER_URL ?? 'http://updater:8787').replace(/\/+$/, '')

  if (config.allowedUserIds.length === 0) {
    logger.warn('dsh-telegram-connector: allowedUserIds is empty; every message will be refused')
  }

  const isAllowed = (userId: number | undefined): boolean =>
    userId !== undefined && config.allowedUserIds.includes(userId)

  /** Diagnostics go to stderr: the harness logger is not visible in container logs. */
  const stderr = (line: string): void => {
    process.stderr.write(`[dsh-telegram-connector] ${line}\n`)
  }

  // One global runtime skill; the per-agent prompt section is installed in
  // ensureAgent's setup callback.
  if (!registerTelegramSkill(ctx)) {
    stderr('telegram rich-text skill: not registered (skills service unavailable or skill file missing)')
  }

  // Serialize bindings writes: saves are snapshots taken when the write runs,
  // so overlapping renames must not let an older snapshot win.
  let persistChain: Promise<void> = Promise.resolve()
  const persist = (): Promise<void> => {
    persistChain = persistChain.then(async () => {
      try {
        await saveBindings(file, bindings)
      } catch (error) {
        logger.warn(`dsh-telegram-connector: cannot persist bindings: ${String(error)}`)
      }
    })
    return persistChain
  }

  // --- reactions -----------------------------------------------------------

  /** Durable `/reactions` overrides win over the plugin row. */
  const reactionSettings = (): ReactionSettings => resolveReactions(bindings.reactions, {
    enabled: config.reactionsEnabled,
    read: config.readReaction,
    streaming: config.streamingReaction,
    staged: config.stagedReaction,
  })

  const reactionWarned = new Set<string>()
  const react = async (
    bot: BotHandle,
    chatId: number,
    messageId: number,
    emoji: string,
  ): Promise<void> => {
    try {
      await bot.client.setMessageReaction(chatId, messageId, emoji.length === 0 ? [] : [emoji])
    } catch (error) {
      // Cosmetic: a group where the bot cannot react must not break delivery.
      const key = `${chatId}:${bot.label}`
      if (reactionWarned.has(key)) return
      reactionWarned.add(key)
      logger.warn(`dsh-telegram-connector: cannot set reactions in chat ${chatId} (${bot.label}): ${String(error)}`)
    }
  }

  /** Telegram redelivers unconfirmed updates; react to a prompt at most once. */
  const reactedMessages = new Set<string>()
  const markPromptRead = async (message: TgMessage): Promise<void> => {
    const settings = reactionSettings()
    if (!settings.enabled || settings.read.length === 0) return
    const key = `${message.chat.id}:${message.message_id}`
    if (reactedMessages.has(key)) return
    reactedMessages.add(key)
    if (reactedMessages.size > 2000) reactedMessages.clear()
    await react(botPool.main, message.chat.id, message.message_id, settings.read)
  }

  /** The message will be edited as the turn streams; mark it until it settles. */
  const markStreamingReaction = (runtime: TopicRuntime, bot: BotHandle, messageId: number): void => {
    const settings = reactionSettings()
    if (!settings.enabled || settings.streaming.length === 0) return
    if (runtime.reactionParts.has(messageId)) return
    // Keep the in-flight set call: a very short turn can finish before it lands,
    // and the clear must run after it or the reaction would be left behind.
    runtime.reactionParts.set(messageId, {
      bot,
      pending: react(bot, runtime.chatId, messageId, settings.streaming),
    })
  }

  const clearStreamReactions = async (runtime: TopicRuntime): Promise<void> => {
    if (runtime.reactionParts.size === 0) return
    const entries = [...runtime.reactionParts.entries()]
    runtime.reactionParts.clear()
    await Promise.all(entries.map(async ([messageId, entry]) => {
      await entry.pending
      await react(entry.bot, runtime.chatId, messageId, '')
    }))
  }

  // --- staged media --------------------------------------------------------

  /** Media that arrived without a caption, keyed by chat:topic:user. */
  const stagedMedia = new Map<string, StagedMedia[]>()
  /** Albums are several updates; collect them before deciding stage vs prompt. */
  const pendingGroups = new Map<string, PendingMediaGroup>()
  const STAGED_TTL_MS = 15 * 60 * 1000
  const PROCESS_CARD_TTL_MS = 30 * 60 * 1000
  const MEDIA_GROUP_WINDOW_MS = 1000
  let stagedSweep: NodeJS.Timeout | undefined

  const toStaged = (message: TgMessage, media: MediaDescriptor): StagedMedia => ({
    ...media,
    chatId: message.chat.id,
    threadId: message.message_thread_id ?? 0,
    userId: message.from?.id ?? 0,
    messageId: message.message_id,
    createdAt: Date.now(),
  })

  const markStaged = (items: readonly StagedMedia[]): void => {
    const settings = reactionSettings()
    if (!settings.enabled || settings.staged.length === 0) return
    for (const item of items) void react(botPool.main, item.chatId, item.messageId, settings.staged)
  }

  const unmarkStaged = (items: readonly StagedMedia[]): void => {
    for (const item of items) void react(botPool.main, item.chatId, item.messageId, '')
  }

  const addStaged = (items: readonly StagedMedia[]): void => {
    if (items.length === 0) return
    const first = items[0]
    if (first === undefined) return
    const key = stagedKey(first.chatId, first.threadId, first.userId)
    const list = stagedMedia.get(key) ?? []
    list.push(...items)
    stagedMedia.set(key, list)
    markStaged(items)
  }

  const takeStaged = (key: string): StagedMedia[] => {
    const items = stagedMedia.get(key) ?? []
    stagedMedia.delete(key)
    unmarkStaged(items)
    return items
  }

  const clearPendingGroupsForTopic = (chatId: number, threadId: number): void => {
    for (const [key, group] of pendingGroups) {
      if (group.chatId !== chatId || group.threadId !== threadId) continue
      if (group.timer !== undefined) clearTimeout(group.timer)
      pendingGroups.delete(key)
    }
  }

  const clearPendingGroupsForChat = (chatId: number): void => {
    for (const [key, group] of pendingGroups) {
      if (group.chatId !== chatId) continue
      if (group.timer !== undefined) clearTimeout(group.timer)
      pendingGroups.delete(key)
    }
  }

  const clearStagedForTopic = (chatId: number, threadId: number): void => {
    clearPendingGroupsForTopic(chatId, threadId)
    for (const [key, items] of stagedMedia) {
      const first = items[0]
      if (first === undefined || first.chatId !== chatId || first.threadId !== threadId) continue
      stagedMedia.delete(key)
      unmarkStaged(items)
    }
  }

  const clearStagedForChat = (chatId: number): void => {
    clearPendingGroupsForChat(chatId)
    for (const [key, items] of stagedMedia) {
      const first = items[0]
      if (first === undefined || first.chatId !== chatId) continue
      stagedMedia.delete(key)
      unmarkStaged(items)
    }
  }

  const sweepStaged = (): void => {
    const now = Date.now()
    for (const [key, items] of stagedMedia) {
      const expired = items.filter((item) => now - item.createdAt >= STAGED_TTL_MS)
      if (expired.length === 0) continue
      unmarkStaged(expired)
      const fresh = items.filter((item) => now - item.createdAt < STAGED_TTL_MS)
      if (fresh.length === 0) stagedMedia.delete(key)
      else stagedMedia.set(key, fresh)
    }
  }

  const startStagedSweep = (): void => {
    if (stagedSweep !== undefined) return
    stagedSweep = setInterval(sweepStaged, 60_000)
  }

  const stopStagedSweep = (): void => {
    if (stagedSweep !== undefined) clearInterval(stagedSweep)
    stagedSweep = undefined
  }

  let processCardSweep: NodeJS.Timeout | undefined
  /** Assigned once mirror state is declared, so one sweep covers both surfaces. */
  let sweepMirrorCards = (): void => undefined

  const sweepProcessCards = (): void => {
    const now = Date.now()
    for (const runtime of runtimes.values()) {
      if (runtime.processActive !== true) continue
      const card = runtime.processCard
      if (card === undefined) continue
      if (now - card.lastTouched < PROCESS_CARD_TTL_MS) continue
      runtime.processActive = false
      runtime.process = runtime.process.map((item) => item.status === 'running'
        ? { ...item, status: 'error' as const, detail: 'timed out' }
        : item)
      const items = runtime.process
      runtime.process = []
      runtime.processCard = undefined
      if (card !== undefined) {
        if (items.length > 0) void finalizeProcessCard(card, items, '⚠️ Process interrupted')
        else forgetProcessCard(card.sessionId)
      }
    }
    sweepMirrorCards()
  }

  const startProcessCardSweep = (): void => {
    if (processCardSweep !== undefined) return
    processCardSweep = setInterval(sweepProcessCards, 60_000)
  }

  const stopProcessCardSweep = (): void => {
    if (processCardSweep !== undefined) clearInterval(processCardSweep)
    processCardSweep = undefined
  }

  // --- outbox, queue status and saturation stats ---------------------------

  const outboxDir = join(dshHome, 'telegram-connector', 'outbox')
  const statsFile = join(dshHome, 'telegram-connector', 'rate-stats.json')

  interface RateStatsDay { saturated: number; lost: number; maxQueue: number }
  interface RateStats { days: Record<string, RateStatsDay>; lastReportAt?: number }
  let rateStats: RateStats = { days: {} }
  const dayKey = (): string => new Date().toISOString().slice(0, 10)

  const loadRateStats = async (): Promise<void> => {
    try {
      const parsed = JSON.parse(await readFile(statsFile, 'utf8')) as RateStats
      if (parsed !== null && typeof parsed === 'object' && parsed.days !== null && typeof parsed.days === 'object') {
        rateStats = { days: parsed.days, lastReportAt: parsed.lastReportAt }
      }
    } catch {
      // first boot, or a hand-edited file
    }
  }

  let statsChain: Promise<void> = Promise.resolve()
  const saveRateStats = (): Promise<void> => {
    statsChain = statsChain.then(async () => {
      try {
        await mkdir(join(dshHome, 'telegram-connector'), { recursive: true })
        const temporary = `${statsFile}.${randomUUID().slice(0, 8)}.tmp`
        const handle = await open(temporary, 'w', 0o600)
        try {
          await handle.writeFile(JSON.stringify(rateStats, null, 2))
          await handle.sync()
        } finally {
          await handle.close()
        }
        await rename(temporary, statsFile)
      } catch (error) {
        logger.warn(`dsh-telegram-connector: cannot persist rate stats: ${String(error)}`)
      }
    })
    return statsChain
  }

  const pruneStats = (): void => {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    for (const day of Object.keys(rateStats.days)) {
      if (day < cutoff) delete rateStats.days[day]
    }
  }

  const lastLostNotice = new Map<number, number>()
  const suppressedLost = new Map<number, number>()

  const noteLost = async (item: OutboxItem, reason: string): Promise<void> => {
    stderr(`outbox lost a message for chat ${item.chatId}: ${reason}`)
    const day = rateStats.days[dayKey()] ?? { saturated: 0, lost: 0, maxQueue: 0 }
    day.lost += 1
    rateStats.days[dayKey()] = day
    await saveRateStats()

    if (bindings.controlChatId === undefined) return
    // One notice per group per minute; anything else is counted for the next one.
    const now = Date.now()
    const previous = lastLostNotice.get(item.chatId) ?? 0
    if (now - previous < 60_000) {
      suppressedLost.set(item.chatId, (suppressedLost.get(item.chatId) ?? 0) + 1)
      return
    }
    lastLostNotice.set(item.chatId, now)
    const suppressed = suppressedLost.get(item.chatId) ?? 0
    suppressedLost.set(item.chatId, 0)

    const workspace = Object.values(bindings.workspaces).find((candidate) => candidate.chatId === item.chatId)
    const session = item.threadId === 0 ? undefined : sessionFor(bindings, item.chatId, item.threadId)
    const where = workspace === undefined
      ? `chat \`${item.chatId}\``
      : `**${workspace.title}**${session?.title === undefined ? '' : ` · topic “${session.title}”`}`
    const kind = reason.includes('outcome unknown') || reason.includes('process stopped')
      ? 'delivery could not be confirmed'
      : reason.includes('queue full')
        ? 'was dropped because the queue was full'
        : reason.includes('no bot')
          ? 'had no available bot in that group'
          : 'was not delivered'
    const clean = item.text.replace(/\s+/g, ' ').trim()
    const snippet = clean.slice(0, 160)
    const lines = [
      `⚠️ **a message ${kind}** in ${where}`,
      snippet.length > 0 ? `> ${snippet}${clean.length > 160 ? '…' : ''}` : '',
      suppressed > 0 ? `_and ${suppressed} earlier item(s) in this group since the last notice_` : '',
      '_the full text is in the session transcript — resend it there if it matters._',
    ]
    await sendTo(bindings.controlChatId, 0, lines.filter((line) => line.length > 0).join('\n'), 'control')
  }

  const reportRateLimit = async (): Promise<void> => {
    if (bindings.controlChatId === undefined) return
    const days = Object.values(rateStats.days)
    const saturated = days.reduce((sum, day) => sum + day.saturated, 0)
    const lost = days.reduce((sum, day) => sum + day.lost, 0)
    const maxQueue = days.reduce((max, day) => Math.max(max, day.maxQueue), 0)
    const publishers = botPool.bots.filter((bot) => !bot.main).length
    const lines = [
      '**rate limit report** · last 7 days',
      `saturated ${saturated} time(s) · max queue ${maxQueue} · lost ${lost}`,
      `bots: main + ${publishers} publisher(s)`,
      'consider adding a publisher bot to raise the group ceiling (20 messages/min per bot).',
    ]
    await sendTo(bindings.controlChatId, 0, lines.join('\n'), 'control')
  }

  let lastSaturationAt = 0
  const noteSaturated = async (waitMs: number, depth: number): Promise<void> => {
    if (Date.now() - lastSaturationAt < 60_000) return
    lastSaturationAt = Date.now()
    const day = rateStats.days[dayKey()] ?? { saturated: 0, lost: 0, maxQueue: 0 }
    day.saturated += 1
    day.maxQueue = Math.max(day.maxQueue, depth)
    rateStats.days[dayKey()] = day
    pruneStats()
    await saveRateStats()
    const last = rateStats.lastReportAt ?? 0
    if (Date.now() - last < 6 * 60 * 60 * 1000) return
    rateStats.lastReportAt = Date.now()
    await saveRateStats()
    logger.warn(`dsh-telegram-connector: rate limit saturated for ~${Math.round(waitMs / 1000)}s with ${depth} queued`)
    await reportRateLimit()
  }

  const queueStatusMessages = new Map<number, number>()
  const queueStatusDepth = new Map<number, number>()
  const queueStatusTimers = new Map<number, NodeJS.Timeout>()

  const updateQueueStatus = async (chatId: number, depth: number): Promise<void> => {
    const workspace = Object.values(bindings.workspaces).find((candidate) => candidate.chatId === chatId)
    if (workspace === undefined) return
    const threadId = workspace.systemThreadId ?? 0
    const existing = queueStatusMessages.get(chatId)
    if (depth === 0) {
      if (existing === undefined) return
      queueStatusMessages.delete(chatId)
      await botPool.waitEdit(botPool.main, chatId).catch(() => undefined)
      await client.editMessageText(chatId, existing, '✅ queue clear — every reply was delivered.').catch(() => undefined)
      return
    }
    const text = `⏳ Telegram rate limit — ${depth} message(s) queued; delivery is automatic.`
    if (existing === undefined) {
      await botPool.takeMain(chatId)
      try {
        const sent = await client.sendMessage(chatId, text, { threadId })
        queueStatusMessages.set(chatId, sent.message_id)
      } catch (error) {
        logger.warn(`dsh-telegram-connector: cannot post queue status: ${String(error)}`)
      }
      return
    }
    await botPool.waitEdit(botPool.main, chatId)
    await client.editMessageText(chatId, existing, text).catch(() => undefined)
  }

  const queueDepthChanged = (chatId: number, depth: number): void => {
    if (chatId > 0) return
    queueStatusDepth.set(chatId, depth)
    if (queueStatusTimers.has(chatId)) return
    const delay = depth === 0 ? 0 : 2000
    queueStatusTimers.set(chatId, setTimeout(() => {
      queueStatusTimers.delete(chatId)
      const latest = queueStatusDepth.get(chatId) ?? 0
      void updateQueueStatus(chatId, latest).catch((error: unknown) => {
        logger.warn(`dsh-telegram-connector: queue status failed: ${String(error)}`)
      })
    }, delay))
  }

  const bridge = new SessionBridge(join(dshHome, 'telegram-connector', 'bridge'))

  const outbox = new Outbox({
    dir: outboxDir,
    pool: botPool,
    onDepth: queueDepthChanged,
    onSaturation: (_chatId, waitMs, depth) => {
      void noteSaturated(waitMs, depth).catch((error: unknown) => stderr(`stats: ${String(error)}`))
    },
    onLost: (item, reason) => {
      void noteLost(item, reason).catch((error: unknown) => stderr(`lost note: ${String(error)}`))
    },
    logger: (line) => stderr(line),
  })

  /**
   * Persist the update offset before an action that kills this process.
   * Telegram redelivers unconfirmed updates, so a restart command that is not
   * recorded first runs a second time after the restart.
   */
  const flushOffset = async (): Promise<void> => {
    if (bindings.lastUpdateId === offset) return
    bindings.lastUpdateId = offset
    await persist()
  }

  // --- sending -------------------------------------------------------------

  const sendChunkVia = async (
    bot: BotHandle,
    chatId: number,
    threadId: number,
    markdown: string,
  ): Promise<TgMessage> => {
    const html = toTelegramHtml(markdown)
    try {
      return await bot.client.sendMessage(chatId, html, { threadId, parseMode: 'HTML' })
    } catch (error) {
      if (error instanceof TelegramApiError && error.errorCode === 400) {
        // Never resend Markdown source: a table would arrive as raw pipes.
        return bot.client.sendMessage(chatId, toPlainText(markdown), { threadId })
      }
      throw error
    }
  }

  /** Everything that can wait goes through the outbox and its bot pool. */
  const sendTo = async (
    chatId: number,
    threadId: number,
    markdown: string,
    priority: ItemPriority = 'normal',
  ): Promise<void> => {
    for (const chunk of splitMessage(markdown)) {
      await outbox.enqueue({
        id: randomUUID(),
        chatId,
        threadId,
        text: chunk,
        priority,
        createdAt: Date.now(),
      }).catch((error: unknown) => {
        logger.warn(`dsh-telegram-connector: cannot queue message: ${String(error)}`)
      })
    }
  }

  /** Send immediately from the main bot; used just before a restart, where the
   * reply must not sit in a queue that outlives this process. */
  const replyNow = async (message: TgMessage, markdown: string): Promise<void> => {
    for (const chunk of splitMessage(markdown)) {
      await botPool.takeMain(message.chat.id)
      await sendChunkVia(botPool.main, message.chat.id, message.message_thread_id ?? 0, chunk)
        .catch((error: unknown) => logger.warn(`dsh-telegram-connector: immediate send failed: ${String(error)}`))
    }
  }

  const deleteMessage = (chatId: number, messageId: number): Promise<boolean> =>
    client.call<boolean>('deleteMessage', { chat_id: chatId, message_id: messageId })

  const reply = (message: TgMessage, markdown: string): Promise<void> =>
    sendTo(message.chat.id, message.message_thread_id ?? 0, markdown)

  const replyInControl = async (markdown: string): Promise<void> => {
    if (bindings.controlChatId === undefined) return
    await sendTo(bindings.controlChatId, 0, markdown)
  }

  // --- supervised restarts -------------------------------------------------

  const supervisorStatus = async (): Promise<SupervisorStatus | undefined> => {
    if (supervisor === undefined) return undefined
    try {
      return await supervisor.status()
    } catch (error) {
      stderr(`supervisor status failed: ${String(error)}`)
      return undefined
    }
  }

  const supervisorLine = async (): Promise<string> => {
    if (supervisor === undefined) return 'supervisor: none — restarts need the host'
    const status = await supervisorStatus()
    if (status === undefined) return 'supervisor: unreachable'
    if (status.trial === null) return `supervisor: runtime ${status.child} · no trial`
    const deadline = status.trial.deadline === null
      ? 'not armed yet'
      : `rollback ${deadlineText(status.trial.deadline)}`
    return `supervisor: trial open, ${deadline}`
  }

  const restartRuntime = async (message: TgMessage, argument: string): Promise<void> => {
    if (supervisor === undefined) {
      return reply(
        message,
        'this runtime is not running under the supervisor, so it cannot restart itself — restart it from the host.',
      )
    }
    // Trial is the default: a restart that cannot be undone by the bot itself is
    // exactly the situation this surface exists to avoid.
    const mode = argument.trim().toLowerCase()
    const trial = mode !== 'now' && mode !== 'plain'
    try {
      await flushOffset()
      await replyNow(
        message,
        trial
          ? 'restarting into a **trial** — once the bot is back you get a rollback window.'
          : 'restarting now — the bot will be away for a few seconds, and this state becomes the rollback point.',
      )
      await supervisor.restart(trial)
    } catch (error) {
      return reply(message, `⚠️ ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const updaterFetch = async (path: string, body?: unknown): Promise<Response> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      return await fetch(`${updaterUrl}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          authorization: `Bearer ${updaterToken}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  const describeBlockingAgent = (agent: Agent): string => {
    const sessionId = agent.session.header.id
    const found = bindingForSession(String(sessionId))
    if (found === undefined) return String(sessionId)
    const workspace = bindings.workspaces[found.bound.workspaceId]
    const topic = found.bound.title ?? `topic ${String(found.threadId)}`
    return workspace === undefined ? topic : `${workspace.title} / ${topic}`
  }

  const updateKeyboard = (id: string) => ({
    inline_keyboard: [[{ text: '✖ Cancel update', callback_data: `upd:cancel:${id}` }]],
  })

  const updateStatusText = (update: NonNullable<typeof bindings.update>): string => {
    const blockers = drainState?.blockers ?? []
    const lines = [`🔄 **setup update** \`${update.from} → ${update.target}\``]
    if (update.phase === 'accepted') {
      lines.push('🚀 updater accepted — cancelling is no longer possible.', 'the bot will restart; the updater reports the result.')
      return lines.join('\n')
    }
    lines.push(
      blockers.length === 0
        ? 'draining: waiting for the last turns to finish'
        : `draining: ${String(blockers.length)} session(s) still working`,
    )
    for (const blocker of blockers.slice(0, 8)) lines.push(`· ${blocker}`)
    if (blockers.length > 8) lines.push(`· … and ${String(blockers.length - 8)} more`)
    lines.push('_Cancel is available until the updater takes over._')
    return lines.join('\n')
  }

  const editUpdateStatus = async (keyboard: boolean): Promise<void> => {
    const update = bindings.update
    if (update === undefined || update.messageId === undefined) return
    await botPool.waitEdit(botPool.main, update.chatId)
    await client.editMessageText(update.chatId, update.messageId, toTelegramHtml(updateStatusText(update)), {
      parseMode: 'HTML',
      replyMarkup: keyboard ? updateKeyboard(update.id) : { inline_keyboard: [] },
    })
  }

  const clearUpdate = async (): Promise<void> => {
    delete bindings.update
    drainState = undefined
    blockedNotified.clear()
    await persist()
  }

  /** Fallback report/card close if the updater could not reach Telegram itself. */
  const reportStoredUpdate = async (pending: NonNullable<typeof bindings.update>): Promise<void> => {
    const file = resolve(dshHome, '..', 'update', 'result.json')
    for (let attempt = 0; attempt < 18; attempt += 1) {
      await pause(attempt === 0 ? 5000 : 3000)
      let result: {
        state?: string; from?: string; target?: string; logTail?: string
        reporting?: boolean; reported?: boolean
      }
      try {
        result = JSON.parse(await readFile(file, 'utf8'))
      } catch {
        return // no persisted result; the updater reported directly
      }
      if (result.from !== pending.from || result.target !== pending.target) continue
      if (result.state !== 'done' && result.state !== 'rolled-back' && result.state !== 'failed') continue
      if (result.reporting === true && attempt < 17) continue

      const from = result.from ?? 'previous'
      const target = result.target ?? 'new setup'
      const dsh = target.includes('-') ? target.slice(1, target.lastIndexOf('-')) : 'unknown'
      const clean = (result.logTail ?? '').split('\n').slice(-20).join('\n')
      const report = result.state === 'done'
        ? `✅ setup update finished: ${from} → ${target} (DSH ${dsh}).`
        : result.state === 'rolled-back'
          ? `⚠️ setup update failed and rolled back to ${from}.\n\n${clean}`
          : `⚠️ setup update failed (${result.state}).\n\n${clean}`
      const card = result.state === 'done'
        ? `✅ setup update finished: ${from} → ${target}.`
        : result.state === 'rolled-back'
          ? `⚠️ setup update failed and rolled back to ${from}.`
          : '⚠️ setup update failed.'

      if (bindings.controlChatId !== undefined && result.reported !== true) {
        await sendTo(bindings.controlChatId, 0, report, 'control')
      }
      if (pending.messageId !== undefined) {
        await client.editMessageText(pending.chatId, pending.messageId, card, {
          replyMarkup: { inline_keyboard: [] },
        }).catch((error: unknown) => logger.warn(`dsh-telegram-connector: cannot close update card: ${String(error)}`))
      }
      await unlink(file).catch(() => undefined)
      return
    }
  }

  const finishUpdateStatus = async (text: string): Promise<void> => {
    const update = bindings.update
    if (update !== undefined && update.messageId !== undefined) {
      await client.editMessageText(update.chatId, update.messageId, text, { replyMarkup: { inline_keyboard: [] } })
        .catch((error: unknown) => logger.warn(`dsh-telegram-connector: cannot edit update status: ${String(error)}`))
    }
    await clearUpdate()
  }

  const cancelUpdate = async (query: TgCallbackQuery): Promise<void> => {
    if (!isAllowed(query.from?.id)) {
      await client.answerCallbackQuery(query.id, 'not authorized').catch(() => undefined)
      return
    }
    const id = query.data?.split(':')[2]
    const update = bindings.update
    if (update === undefined || id === undefined || update.id !== id || update.phase !== 'draining') {
      await client.answerCallbackQuery(query.id, 'update already started or finished').catch(() => undefined)
      if (query.message !== undefined) {
        await client.editMessageText(
          query.message.chat.id,
          query.message.message_id,
          'this update is no longer cancellable.',
          { replyMarkup: { inline_keyboard: [] } },
        ).catch(() => undefined)
      }
      return
    }
    const chatId = update.chatId
    const messageId = update.messageId
    await clearUpdate()
    if (messageId !== undefined) {
      await client.editMessageText(chatId, messageId, '❌ setup update cancelled.', { replyMarkup: { inline_keyboard: [] } })
        .catch((error: unknown) => logger.warn(`dsh-telegram-connector: cannot edit cancelled status: ${String(error)}`))
    }
    await client.answerCallbackQuery(query.id, 'setup update cancelled').catch(() => undefined)
  }

  const waitForDrain = async (): Promise<void> => {
    let signature = ''
    for (;;) {
      if (bindings.update === undefined) return
      const running = agents.list().filter((agent) => agent.status === 'running')
      const blockers = running.map(describeBlockingAgent)
      if (drainState !== undefined) drainState.blockers = blockers
      const next = blockers.join('\n')
      if (next !== signature) {
        signature = next
        await editUpdateStatus(true).catch((error: unknown) => {
          logger.warn(`dsh-telegram-connector: cannot update drain status: ${String(error)}`)
        })
      }
      if (running.length === 0) return
      await pause(2000)
    }
  }

  const watchUpdate = async (jobId: string): Promise<void> => {
    for (;;) {
      await pause(2000)
      if (bindings.update === undefined) return
      try {
        const response = await updaterFetch('/status')
        if (!response.ok) continue
        const status = await response.json() as { job?: { id?: string; state?: string } | null }
        const job = status.job
        if (job === null || job === undefined || job.id !== jobId) continue
        if (job.state === 'done' || job.state === 'failed' || job.state === 'rolled-back') {
          // The updater is the reporter; this only retires the editable card if
          // the connector survived a pre-stop failure.
          await finishUpdateStatus('setup update ended — see the updater report.')
          return
        }
      } catch {
        // updater temporarily unavailable; keep waiting
      }
    }
  }

  const runSetupUpdate = async (mode: 'compatible' | 'available'): Promise<void> => {
    try {
      await waitForDrain()
      if (bindings.update === undefined) return
      const response = await updaterFetch('/update', { mode })
      if (response.status !== 202) {
        const detail = await response.text().catch(() => '')
        await finishUpdateStatus(`❌ setup update was not accepted: ${detail.slice(0, 300)}`)
        return
      }
      const accepted = await response.json() as { job?: string; from?: string; target?: string }
      if (accepted.from !== undefined) bindings.update.from = accepted.from
      if (accepted.target !== undefined) bindings.update.target = accepted.target
      bindings.update.phase = 'accepted'
      await persist()
      await editUpdateStatus(false).catch((error: unknown) => {
        logger.warn(`dsh-telegram-connector: cannot edit accepted status: ${String(error)}`)
      })
      if (accepted.job !== undefined) void watchUpdate(accepted.job)
    } catch (error) {
      await finishUpdateStatus(`❌ setup update failed: ${String(error)}`)
    }
  }

  const updateAll = async (message: TgMessage, mode: 'compatible' | 'available'): Promise<void> => {
    if (updaterToken.length === 0) {
      return reply(
        message,
        [
          '**setup updates are not wired here** — `DSH_UPDATER_TOKEN` is empty.',
          '',
          'on the host:',
          '`./update.sh --self-check` — latest compatible setup tag',
          '`./update.sh --self` — apply it (health gate and rollback)',
        ].join('\n'),
      )
    }
    if (bindings.update !== undefined) {
      return reply(message, 'a setup update is already in progress — `/system status` shows what it is waiting for.')
    }
    let health: { canApply?: boolean; tag?: string | null } | undefined
    let resolved: { from?: string; target?: string } | undefined
    try {
      const response = await updaterFetch('/health')
      if (!response.ok) throw new Error(`updater answered ${String(response.status)}`)
      health = await response.json() as { canApply?: boolean; tag?: string | null }
      if (health.canApply !== true) {
        return reply(message, 'the updater is running but cannot apply yet — check `docker compose logs updater`.')
      }
      const target = await updaterFetch('/target', { mode })
      if (target.status === 404) {
        // Older updater without /target: /update still resolves the target.
        resolved = { from: health.tag ?? 'current', target: 'next compatible' }
      } else if (!target.ok) {
        const detail = await target.text().catch(() => '')
        return reply(message, `⚠️ no setup update target: ${detail.slice(0, 300)}`)
      } else {
        resolved = await target.json() as { from?: string; target?: string }
      }
    } catch (error) {
      return reply(message, `⚠️ updater is not reachable: ${String(error)}`)
    }
    if (resolved?.from === undefined || resolved.target === undefined) {
      return reply(message, 'the updater returned no target.')
    }

    const id = randomUUID().slice(0, 8)
    bindings.update = {
      id,
      startedAt: Date.now(),
      mode,
      phase: 'draining',
      from: resolved.from,
      target: resolved.target,
      chatId: message.chat.id,
    }
    drainState = { mode, startedAt: bindings.update.startedAt, blockers: [] }
    await persist()
    try {
      await botPool.takeMain(message.chat.id)
      const sent = await client.sendMessage(message.chat.id, toTelegramHtml(updateStatusText(bindings.update)), {
        parseMode: 'HTML',
        replyMarkup: updateKeyboard(id),
      })
      bindings.update.messageId = sent.message_id
      await persist()
    } catch (error) {
      await clearUpdate()
      return reply(message, `⚠️ cannot post the update status: ${String(error)}`)
    }
    void runSetupUpdate(mode)
  }

  // --- optional components -------------------------------------------------
  interface ComponentInfo {
    name: string
    label: string
    description: string
    enabled: boolean
    port?: number
  }

  const fetchComponents = async (): Promise<ComponentInfo[]> => {
    const response = await updaterFetch('/components')
    if (!response.ok) throw new Error(`updater answered ${String(response.status)}`)
    const body = await response.json() as { components?: ComponentInfo[] }
    return body.components ?? []
  }

  const componentsText = (components: readonly ComponentInfo[]): string => {
    const lines = ['**components**']
    if (components.length === 0) lines.push('nothing registered')
    for (const component of components) {
      const state = component.enabled ? '**on**' : 'off'
      const port = component.port === undefined ? '' : ` · port ${String(component.port)}`
      lines.push(`• ${component.label} — ${state}${port}`)
    }
    lines.push('', 'enable/disable starts or stops the stack; the runtime restarts so the tools follow.')
    return lines.join('\n')
  }

  const componentsKeyboard = (components: readonly ComponentInfo[]) => ({
    inline_keyboard: components.map((component) => ([
      {
        text: component.enabled ? '⏹ Disable' : '▶️ Enable',
        callback_data: `cmp:${component.enabled ? 'disable' : 'enable'}:${component.name}`,
      },
      {
        text: component.port === undefined ? '⚙️ Port' : `⚙️ Port ${String(component.port)}`,
        callback_data: `cmp:port:${component.name}`,
      },
    ])),
  })

  const postComponent = async (name: string, action: 'enable' | 'disable' | 'configure', port?: number): Promise<string> => {
    const response = await updaterFetch('/components', { name, action, ...(port === undefined ? {} : { port }) })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      return `⚠️ updater refused (${String(response.status)})${detail.length > 0 ? `: ${detail.slice(0, 200)}` : ''}`
    }
    return `⏳ ${name}: ${action}${port === undefined ? '' : ` ${String(port)}`} accepted — the updater reports when it is done.`
  }

  const showComponents = async (message: TgMessage): Promise<void> => {
    if (updaterToken.length === 0) {
      return reply(message, '**components** — set `DSH_UPDATER_TOKEN` to manage them from here.')
    }
    let components: ComponentInfo[]
    try {
      components = await fetchComponents()
    } catch (error) {
      return reply(message, `⚠️ cannot reach the updater: ${error instanceof Error ? error.message : String(error)}`)
    }
    await client.sendMessage(message.chat.id, toTelegramHtml(componentsText(components)), {
      parseMode: 'HTML',
      replyMarkup: componentsKeyboard(components),
    })
  }

  const manageComponents = async (message: TgMessage, args: readonly string[]): Promise<void> => {
    if (args.length === 0) return showComponents(message)
    const [name, action, value] = args
    if (name === undefined || action === undefined) {
      return reply(message, 'usage: `/system manage [<component> <enable|disable|port> [<port>]]`')
    }
    if (action === 'enable' || action === 'disable') {
      return reply(message, await postComponent(name, action))
    }
    if (action === 'port') {
      const port = Number(value)
      if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        return reply(message, 'usage: `/system manage <component> port <1024-65535>`')
      }
      return reply(message, await postComponent(name, 'configure', port))
    }
    return reply(message, 'usage: `/system manage [<component> <enable|disable|port> [<port>]]`')
  }

  const handleComponentButton = async (query: TgCallbackQuery): Promise<void> => {
    const [, action, name, value] = (query.data ?? '').split(':')
    const card = query.message
    if (name === undefined || card === undefined) {
      await client.answerCallbackQuery(query.id, 'unknown action').catch(() => undefined)
      return
    }
    if (action === 'port') {
      await client.answerCallbackQuery(query.id, 'choose a port').catch(() => undefined)
      const current = value ?? ''
      await client.editMessageText(card.chat.id, card.message_id, toTelegramHtml(`**${name}** — port\n\npick one, or send \`/system manage ${name} port <n>\` for another.`), {
        parseMode: 'HTML',
        replyMarkup: {
          inline_keyboard: [[
            { text: '8090', callback_data: `cmp:set:${name}:8090` },
            { text: '8091', callback_data: `cmp:set:${name}:8091` },
            { text: '8092', callback_data: `cmp:set:${name}:8092` },
          ]],
        },
      }).catch(() => undefined)
      void current
      return
    }
    if (action === 'set') {
      const port = Number(value)
      await client.answerCallbackQuery(query.id, 'applying…').catch(() => undefined)
      await client.editMessageText(card.chat.id, card.message_id, toTelegramHtml(await postComponent(name, 'configure', port)), { parseMode: 'HTML' }).catch(() => undefined)
      return
    }
    if (action === 'enable' || action === 'disable') {
      await client.answerCallbackQuery(query.id, 'applying…').catch(() => undefined)
      await client.editMessageText(card.chat.id, card.message_id, toTelegramHtml(await postComponent(name, action)), { parseMode: 'HTML' }).catch(() => undefined)
      return
    }
    await client.answerCallbackQuery(query.id, 'unknown action').catch(() => undefined)
  }

  const handleSystem = async (message: TgMessage, args: readonly string[]): Promise<void> => {
    const [sub, ...tail] = args
    const mode = tail.join(' ').trim()
    if (sub === undefined || sub === 'status') {
      const lines = [`**system**`, await aboutText()]
      if (bindings.update !== undefined && drainState !== undefined) {
        lines.push('', `updating: ${drainState.mode} · waiting for ${String(drainState.blockers.length)} session(s)`)
        for (const blocker of drainState.blockers.slice(0, 10)) lines.push(`· ${blocker}`)
        if (drainState.blockers.length > 10) lines.push(`· … and ${String(drainState.blockers.length - 10)} more`)
      }
      return reply(message, lines.join('\n'))
    }
    if (sub === 'manage' || sub === 'components') return manageComponents(message, tail)
    if (sub === 'restart') return restartRuntime(message, mode)
    if (sub === 'confirm') return confirmTrial(message)
    if (sub === 'rollback') return rollbackTrial(message)
    if (sub === 'update') {
      const [target, ...extra] = tail
      const now = extra.join(' ').trim() === 'now'
      if (target === 'connector') {
        if (extra.length > 0 && !now) return reply(message, 'usage: `/system update connector [now]`')
        return updateConnector(message, now)
      }
      if (target === 'all') {
        const incompatible = extra.length === 1 && extra[0] === '--i-know-versions-are-incompatible'
        if (extra.length > 0 && !incompatible) {
          return reply(message, 'usage: `/system update all [--i-know-versions-are-incompatible]`')
        }
        return updateAll(message, incompatible ? 'available' : 'compatible')
      }
      return reply(message, 'usage: `/system update <connector|all> [now]`')
    }
    return reply(message, 'usage: `/system <status|restart|update|confirm|rollback>`')
  }

  const updaterLine = async (): Promise<string> => {
    if (updaterToken.length === 0) return 'disabled (DSH_UPDATER_TOKEN empty)'
    try {
      const response = await updaterFetch('/health')
      if (!response.ok) return `error ${String(response.status)}`
      const health = await response.json() as { canApply?: boolean; tag?: string | null }
      if (health.canApply !== true) return 'reachable · apply unavailable'
      return `ready · ${health.tag ?? 'unknown tag'}`
    } catch {
      return 'unreachable'
    }
  }

  const aboutText = async (): Promise<string> => {
    const runtime = runtimeVersion()
    const status = await supervisorStatus()
    const trialMinutes = status?.trialSeconds === undefined ? undefined : Math.round(status.trialSeconds / 60)
    return [
      `**dsh-telegram-connector** ${connectorVersion()}`,
      `dsh runtime: ${runtime === undefined ? 'unknown' : `\`${runtime}\``}`,
      `updater: ${await updaterLine()}`,
      `supervisor: ${status === undefined ? 'none' : `present · trial ${String(trialMinutes ?? 0)} min`}`,
      `plugin manager: ${pluginManager() === undefined ? 'none' : 'present'}`,
      `bots: main + ${botPool.bots.filter((bot) => !bot.main).length} publisher(s)`,
    ].join('\n')
  }

  const timeZone = (): string => resolveTimeZone(bindings.timezone, process.env.DSH_TIMEZONE)

  const setTimeZone = async (message: TgMessage, argument: string): Promise<void> => {
    if (argument.length === 0) {
      return reply(
        message,
        [
          `timezone: \`${timeZone()}\``,
          '',
          'used to read times you type (schedules). Reminders and deadlines are rendered by Telegram in your own zone.',
          'change it with `/timezone Europe/Minsk`.',
        ].join('\n'),
      )
    }
    const zone = validTimeZone(argument)
    if (zone === undefined) {
      return reply(message, `\`${argument}\` is not an IANA time zone — try \`Europe/Minsk\`.`)
    }
    bindings.timezone = zone
    await persist()
    return reply(message, `timezone set to \`${zone}\`.`)
  }

  /** `/reactions`: live overrides for the prompt and streaming reactions. */
  const handleReactions = async (message: TgMessage, rest: string[]): Promise<void> => {
    const [rawSlot, ...tail] = rest
    const slot = rawSlot?.toLowerCase()
    const argument = tail.join(' ').trim()

    if (slot === undefined) return reply(message, describeReactions(reactionSettings()))
    if (slot === 'allowed') return reply(message, allowedReactionsText())
    if (slot === 'on' || slot === 'off') {
      bindings.reactions = { ...bindings.reactions, enabled: slot === 'on' }
      await persist()
      if (slot === 'off') {
        // retire spinners already on screen; the next turn will not set new ones
        for (const runtime of runtimes.values()) void clearStreamReactions(runtime)
      }
      return reply(message, `reactions ${slot}.`)
    }
    if (slot === 'reset') {
      delete bindings.reactions
      await persist()
      return reply(message, `reactions reset to defaults.\n\n${describeReactions(reactionSettings())}`)
    }
    if (slot === 'read' || slot === 'streaming' || slot === 'staged') {
      if (argument.length === 0) {
        return reply(message, `usage: \`/reactions ${slot} <emoji>\` — or \`/reactions ${slot} off\``)
      }
      const parsed = parseReactionValue(argument)
      if ('error' in parsed) return reply(message, `⚠️ ${parsed.error}`)
      bindings.reactions = { ...bindings.reactions, [slot]: parsed.value }
      await persist()
      return reply(message, `${slot} reaction set to ${parsed.value.length === 0 ? '_off_' : parsed.value}.`)
    }
    return reply(message, 'usage: `/reactions [read|streaming|staged|on|off|reset|allowed] [emoji]`')
  }

  const confirmTrial = async (message: TgMessage): Promise<void> => {
    if (supervisor === undefined) return reply(message, 'no supervisor is configured.')
    try {
      await supervisor.commit()
    } catch (error) {
      return reply(message, `⚠️ ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!await retireStoredTrialMessage('✅ committed — this state is the rollback point.')) {
      return reply(message, 'committed — this state is now the rollback point.')
    }
  }

  const rollbackTrial = async (message: TgMessage): Promise<void> => {
    if (supervisor === undefined) return reply(message, 'no supervisor is configured.')
    try {
      await flushOffset()
      const retired = await retireStoredTrialMessage('↩️ rolling back to the last committed state…')
      if (!retired) await replyNow(message, 'rolling back to the last committed state — the bot will be back in a moment.')
      await supervisor.rollback('rollback requested from Telegram')
    } catch (error) {
      return reply(message, `⚠️ ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** Reinstall the connector itself: the supervisor stops the runtime, runs reset-plugin, opens a trial. */
  const updateConnector = async (message: TgMessage, noTrial: boolean): Promise<void> => {
    if (supervisor === undefined) {
      return reply(
        message,
        'this runtime has no supervisor — reinstall the connector from the host (`docker compose run --rm dsh reset-plugin`).',
      )
    }
    try {
      await flushOffset()
      await replyNow(
        message,
        noTrial
          ? 'reinstalling the connector — no trial; this restarted state becomes the rollback point.'
          : 'reinstalling the connector from its configured ref — the bot will be away for a few minutes. The new version comes up in a trial: commit it, or it rolls back automatically.',
      )
      await supervisor.update(!noTrial)
    } catch (error) {
      return reply(message, `⚠️ ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const trialKeyboard = (trialId: string) => ({
    inline_keyboard: [[
      { text: '✅ Commit', callback_data: trialCallbackData('commit', trialId) },
      { text: '↩️ Roll back', callback_data: trialCallbackData('rollback', trialId) },
    ]],
  })

  /** A trial message with the two buttons; falls back to plain text if Telegram rejects them. */
  const sendTrialMessage = async (chatId: number, markdown: string, trialId: string): Promise<void> => {
    const stale = bindings.trialMessage
    if (stale !== undefined && stale.trialId !== trialId) {
      await retireStoredTrialMessage('⌛ this trial ended.')
    }
    try {
      const markup = trialKeyboard(trialId)
      const stored = bindings.trialMessage
      if (stored !== undefined && stored.trialId === trialId) {
        // A resumed trial rewrites its original message instead of leaving a
        // second set of buttons behind.
        await botPool.waitEdit(botPool.main, chatId)
        await client.editMessageText(stored.chatId, stored.messageId, toTelegramHtml(markdown), {
          parseMode: 'HTML',
          replyMarkup: markup,
        })
        return
      }
      // Buttons belong to the bot that sent them; only the main bot polls.
      await botPool.takeMain(chatId)
      const sent = await client.sendMessage(chatId, toTelegramHtml(markdown), {
        parseMode: 'HTML',
        replyMarkup: markup,
      })
      bindings.trialMessage = { chatId, messageId: sent.message_id, trialId }
      await persist()
    } catch (error) {
      logger.warn(`dsh-telegram-connector: cannot send trial buttons: ${String(error)}`)
      await sendTo(chatId, 0, markdown)
    }
  }

  /** Replace the stored trial message and drop its keyboard. */
  const retireStoredTrialMessage = async (text: string): Promise<boolean> => {
    const stored = bindings.trialMessage
    if (stored === undefined) return false
    bindings.trialMessage = undefined
    await persist()
    await client.editMessageText(stored.chatId, stored.messageId, text, {
      replyMarkup: { inline_keyboard: [] },
    }).catch(() => undefined)
    return true
  }

  /** Replace the trial message a button belongs to, and forget it. */
  const retireCallbackMessage = async (query: TgCallbackQuery, text: string): Promise<void> => {
    const message = query.message
    if (message === undefined) return
    try {
      await client.editMessageText(message.chat.id, message.message_id, text, {
        replyMarkup: { inline_keyboard: [] },
      })
    } catch {
      // the message may be too old to edit; the answer toast already said what happened
    }
    bindings.trialMessage = undefined
    await persist()
  }

  const handleTrialButton = async (query: TgCallbackQuery): Promise<void> => {
    const parsed = parseTrialCallback(query.data)
    if (parsed === undefined) {
      await client.answerCallbackQuery(query.id, 'unknown action').catch(() => undefined)
      return
    }
    if (supervisor === undefined) {
      await client.answerCallbackQuery(query.id, 'no supervisor is configured').catch(() => undefined)
      await retireCallbackMessage(query, 'no supervisor is configured.')
      return
    }
    const status = await supervisorStatus()
    if (status === undefined || status.trial === null || status.trial.id !== parsed.trialId) {
      await client.answerCallbackQuery(query.id, 'this trial is no longer active').catch(() => undefined)
      await retireCallbackMessage(query, '⌛ this trial is no longer active.')
      return
    }

    if (parsed.action === 'commit') {
      await client.answerCallbackQuery(query.id, 'committing…').catch(() => undefined)
      try {
        await supervisor.commit()
      } catch (error) {
        await retireCallbackMessage(query, `⚠️ commit failed: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
      await retireCallbackMessage(query, '✅ committed — this state is the rollback point.')
      return
    }

    await client.answerCallbackQuery(query.id, 'rolling back…').catch(() => undefined)
    // edit first: the supervisor stops the runtime as soon as rollback starts
    await retireCallbackMessage(query, '↩️ rolling back to the last committed state…')
    try {
      await supervisor.rollback('rollback from the trial message')
    } catch (error) {
      await retireCallbackMessage(query, `⚠️ rollback failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Arm a restart the supervisor already started, announce it once, and confirm
   * a plain restart. Arming is also the health signal: if this never runs, the
   * supervisor rolls back after its boot grace instead of leaving a half-broken
   * runtime in place.
   */
  const announceTrial = async (): Promise<void> => {
    if (supervisor === undefined || bindings.controlChatId === undefined) return
    try {
      const status = await supervisor.status()
      const stored = bindings.trialMessage
      if (stored !== undefined && (status.trial === null || status.trial.id !== stored.trialId)) {
        await retireStoredTrialMessage('⌛ this trial ended.')
      }
      if (status.trial === null) {
        const event = status.lastEvent
        if (event?.kind === 'restart' && Date.now() - event.at < 5 * 60_000) {
          await sendTo(
            bindings.controlChatId,
            0,
            '✅ back up after a plain restart — the current state is the rollback point.',
          )
        }
        return
      }
      const armed = await supervisor.arm()
      if (armed.firstArm !== true) {
        // A container restart inside the window: remind once, without pretending
        // a new trial just started.
        if (typeof armed.deadline === 'number') {
          const label = status.lastEvent?.kind === 'update' ? '**update trial**' : 'trial'
          await sendTrialMessage(
            bindings.controlChatId,
            `${label} still open — rollback ${deadlineText(armed.deadline)}. Commit or roll back below.`,
            status.trial.id,
          )
        }
        return
      }
      const lines = [
        status.lastEvent?.kind === 'update'
          ? '**update trial** — the connector is running the new version.'
          : '**trial running** — the new state is live.',
        'commit it with the buttons below (or `/system confirm`), or put the previous state back with `/system rollback`.',
      ]
      if (typeof armed.deadline === 'number') {
        lines.push(`without confirmation it rolls back ${deadlineText(armed.deadline)}.`)
      }
      await sendTrialMessage(bindings.controlChatId, lines.join('\n'), status.trial.id)
    } catch (error) {
      stderr(`supervisor arm failed: ${String(error)}`)
    }
  }

  // --- plugin surface (profile-global, so it lives in the control chat) -----

  /** The bundle serving this chat: disabling or removing it here would cut the line. */
  const SELF_BUNDLE = 'dsh-telegram-connector'
  const PLUGIN_CONFIRM_TTL_MS = 10 * 60 * 1000

  interface PendingPluginAction {
    userId: number | undefined
    at: number
    action:
      | { kind: 'install'; spec: string; approvedBuilds?: string[] }
      | { kind: 'remove'; name: string }
      | { kind: 'bundle'; name: string; enabled: boolean }
  }

  let pendingPlugin: PendingPluginAction | undefined

  const PLUGIN_USAGE = [
    '**plugins** — the bundles of this profile',
    '',
    '`/plugins` — list them',
    '`/plugin info <name>` — details',
    '`/plugin add <spec>` — inspect, then confirm',
    '`/plugin enable <name>` · `/plugin disable <name>`',
    '`/plugin remove <name>` — uninstall (confirm)',
    '`/plugin confirm` · `/plugin cancel` · `/plugin approve`',
  ].join('\n')

  const pluginManager = (): PluginManagerService | undefined =>
    serviceOf<PluginManagerService>(ctx, 'pluginManager')

  const pluginBundles = async (): Promise<BundleInfo[] | undefined> => {
    const manager = pluginManager()
    if (manager === undefined) return undefined
    try {
      return await manager.listBundles()
    } catch (error) {
      stderr(`plugin manager list failed: ${String(error)}`)
      return undefined
    }
  }

  const noPluginManager = (message: TgMessage): Promise<void> =>
    reply(
      message,
      'this runtime exposes no **plugin manager** — the profile is not base-backed, or the manager is not mounted.',
    )

  const pluginList = async (message: TgMessage): Promise<void> => {
    const bundles = await pluginBundles()
    if (bundles === undefined) return noPluginManager(message)
    return reply(message, describeBundleList(bundles))
  }

  const findBundle = async (needle: string): Promise<BundleInfo | undefined> => {
    const query = needle.trim().toLowerCase()
    if (query.length === 0) return undefined
    const bundles = (await pluginBundles()) ?? []
    return (
      bundles.find((bundle) => bundle.name.toLowerCase() === query) ??
      bundles.find((bundle) => bundle.name.toLowerCase().endsWith(`/${query}`)) ??
      bundles.find((bundle) => (localized(bundle.meta?.title) ?? '').toLowerCase() === query) ??
      bundles.find((bundle) => bundle.name.toLowerCase().includes(query))
    )
  }

  const pluginInfo = async (message: TgMessage, name: string): Promise<void> => {
    const bundle = await findBundle(name)
    if (bundle === undefined) return reply(message, `no bundle matching \`${name}\` — \`/plugins\` lists them.`)
    return reply(message, describeBundle(bundle))
  }

  const pluginFooter = (): string => '`/plugin confirm` to go ahead · `/plugin cancel` to drop it.'

  /**
   * What a confirmation will cost. Without HMR a bundle change only lands on a
   * restart, so saying that before the button is pressed is the difference
   * between a surprise and a plan.
   */
  const restartPreview = async (): Promise<string> => {
    if (supervisor === undefined) {
      return '⚠️ this changes the profile on disk; a restart from the host is needed to load it.'
    }
    const status = await supervisorStatus()
    const minutes = Math.round((status?.trialSeconds ?? 300) / 60)
    if (serviceOf<unknown>(ctx, 'hmr') !== undefined) {
      return `⚠️ HMR applies this live, and the change opens a trial: you then have ${minutes} minutes to \`/system confirm\` it, or it rolls back automatically.`
    }
    return `⚠️ this runtime has no HMR: confirming **restarts** it into a trial. You then have ${minutes} minutes to \`/system confirm\` the new state, or it rolls back automatically.`
  }

  /**
   * Report a bundle mutation and settle its rollback window. A live change
   * keeps the trial opened before the operation; one that needs a restart drops
   * that trial and opens a fresh one around the restart.
   */
  const finishPluginChange = async (
    message: TgMessage,
    result: ChangeResult,
    pastTense: string,
    liveTrial?: { id: string; deadline: number | null },
  ): Promise<void> => {
    const text = describeChange(result, pastTense)
    const restartBound = result.application === 'restart-required' && supervisor !== undefined
    if (restartBound) await replyNow(message, text)
    else await reply(message, text)

    const kept = liveTrial !== undefined && supervisor !== undefined
      && (result.application === 'applied' || result.application === 'overridden')
    if (kept && liveTrial !== undefined && bindings.controlChatId !== undefined) {
      const lines = [
        '**trial running** — the change is live.',
        'commit it with the buttons below (or `/system confirm`), or put the previous state back with `/system rollback`.',
      ]
      if (typeof liveTrial.deadline === 'number') {
        lines.push(`without confirmation it rolls back ${deadlineText(liveTrial.deadline)}.`)
      }
      await sendTrialMessage(bindings.controlChatId, lines.join('\n'), liveTrial.id)
      return
    }

    if (liveTrial !== undefined && supervisor !== undefined) {
      await supervisor.abandonTrial().catch((error: unknown) => {
        stderr(`abandon trial failed: ${String(error)}`)
      })
    }

    if (result.application !== 'restart-required') return
    if (supervisor === undefined) {
      await reply(message, 'restart the runtime from the host to load the change — this runtime has no supervisor.')
      return
    }
    try {
      await replyNow(message, 'restarting into a **trial** — the bot will be right back, then `/system confirm` or `/system rollback`.')
      await flushOffset()
      await supervisor.restart(true)
    } catch (error) {
      await reply(
        message,
        `⚠️ the change is saved, but the restart did not start: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  const beginPluginInstall = async (message: TgMessage, spec: string): Promise<void> => {
    const manager = pluginManager()
    if (manager === undefined) return noPluginManager(message)
    if (spec.length === 0) return reply(message, 'usage: `/plugin add <name|github:owner/repo|path|tarball>`')
    void client.setTyping(message.chat.id)
    let inspection: Inspection
    try {
      inspection = await manager.inspect(spec)
    } catch (error) {
      return reply(message, `⚠️ ${error instanceof Error ? error.message : String(error)}`)
    }
    if (inspection.status === 'refused') return reply(message, describeInspection(inspection))
    if (inspection.bundle === false) {
      return reply(
        message,
        `\`${inspection.name ?? spec}\` declares no DSH bundle patch — installing it would not add a plugin.`,
      )
    }
    pendingPlugin = { userId: message.from?.id, at: Date.now(), action: { kind: 'install', spec } }
    return reply(
      message,
      [
        describeInspection(inspection),
        '',
        '⚠️ a plugin runs with this runtime\'s permissions: its install scripts and its code execute on the host.',
        '',
        await restartPreview(),
        '',
        pluginFooter(),
      ].join('\n'),
    )
  }

  const beginPluginRemove = async (message: TgMessage, name: string): Promise<void> => {
    const bundle = await findBundle(name)
    if (bundle === undefined) return reply(message, `no bundle matching \`${name}\` — \`/plugins\` lists them.`)
    if (bundle.name === SELF_BUNDLE) {
      return reply(
        message,
        'that is the connector serving this chat — removing it here would cut the line. Do it from the host.',
      )
    }
    if (bundle.removable === false) {
      const reason = bundle.readOnlyReason === undefined ? '' : ` (${bundle.readOnlyReason})`
      return reply(message, `\`${bundle.name}\` cannot be removed from here${reason}.`)
    }
    pendingPlugin = { userId: message.from?.id, at: Date.now(), action: { kind: 'remove', name: bundle.name } }
    return reply(
      message,
      [
        `**remove** \`${bundle.name}\`${bundle.version === undefined ? '' : ` ${bundle.version}`}`,
        '',
        'the package leaves this profile and its rows stop running. Files and configuration it wrote stay.',
        '',
        await restartPreview(),
        '',
        pluginFooter(),
      ].join('\n'),
    )
  }

  const runPendingPlugin = async (message: TgMessage): Promise<void> => {
    const pending = pendingPlugin
    if (pending === undefined) return reply(message, 'nothing is waiting for confirmation.')
    if (pending.userId !== undefined && message.from?.id !== pending.userId) {
      return reply(message, 'that confirmation belongs to someone else — ask them, or start again.')
    }
    pendingPlugin = undefined
    if (Date.now() - pending.at > PLUGIN_CONFIRM_TTL_MS) {
      return reply(message, 'that confirmation expired — start again.')
    }
    const manager = pluginManager()
    if (manager === undefined) return noPluginManager(message)

    // Open the window before the change, not after: a live reload that crashes
    // the process must already be covered by a trial.
    let liveTrial: { id: string; deadline: number | null } | undefined
    if (supervisor !== undefined) {
      try {
        const opened = await supervisor.openTrial()
        if (opened.trial === undefined) throw new Error('the supervisor returned no trial')
        liveTrial = { id: opened.trial.id, deadline: opened.trial.deadline }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        return reply(message, `⚠️ cannot open a rollback window (${detail}) — nothing was changed.`)
      }
    }

    const action = pending.action
    try {
      if (action.kind === 'install') {
        void client.setTyping(message.chat.id)
        await reply(message, `installing \`${action.spec}\` — pnpm may take a minute.`)
        const options = action.approvedBuilds === undefined
          ? undefined
          : { approvedBuilds: action.approvedBuilds }
        const result = await manager.installBundle(action.spec, options)
        await finishPluginChange(message, result, 'installed', liveTrial)

        // pnpm 11 blocks dependency scripts until someone names them; keep the
        // request alive so `/plugin approve` can retry this exact spec
        if (
          result.application === 'failed' &&
          action.approvedBuilds === undefined &&
          result.pendingBuilds !== undefined &&
          result.pendingBuilds.length > 0
        ) {
          pendingPlugin = {
            userId: pending.userId,
            at: Date.now(),
            action: { kind: 'install', spec: action.spec, approvedBuilds: result.pendingBuilds },
          }
          await reply(
            message,
            [
              'these dependencies want to run install scripts:',
              result.pendingBuilds.map((name) => `· \`${name}\``).join('\n'),
              '',
              'they run with the host user\'s permissions. `/plugin approve` allows exactly these and retries; `/plugin cancel` drops it.',
            ].join('\n'),
          )
        }
        return
      }

      if (action.kind === 'bundle') {
        const result = await manager.setBundleEnabled(action.name, action.enabled)
        await finishPluginChange(message, result, action.enabled ? 'enabled' : 'disabled', liveTrial)
        return
      }

      const result = await manager.removeBundle(action.name)
      await finishPluginChange(message, result, 'removed', liveTrial)
    } catch (error) {
      if (liveTrial !== undefined) {
        await supervisor?.abandonTrial().catch((abandonError: unknown) => {
          stderr(`abandon trial failed: ${String(abandonError)}`)
        })
      }
      await reply(message, `⚠️ ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const beginPluginBundle = async (message: TgMessage, name: string, enabled: boolean): Promise<void> => {
    const manager = pluginManager()
    if (manager === undefined) return noPluginManager(message)
    const bundle = await findBundle(name)
    if (bundle === undefined) return reply(message, `no bundle matching \`${name}\` — \`/plugins\` lists them.`)
    if (!enabled && bundle.name === SELF_BUNDLE) {
      return reply(
        message,
        'that is the connector serving this chat — disabling it here would cut the line. Do it from the host.',
      )
    }
    if (bundle.enabled === enabled) {
      return reply(message, `\`${bundle.name}\` is already ${enabled ? 'enabled' : 'disabled'}.`)
    }
    pendingPlugin = {
      userId: message.from?.id,
      at: Date.now(),
      action: { kind: 'bundle', name: bundle.name, enabled },
    }
    return reply(
      message,
      [
        `**${enabled ? 'enable' : 'disable'}** \`${bundle.name}\`${bundle.version === undefined ? '' : ` ${bundle.version}`}`,
        '',
        enabled
          ? 'the bundle\'s rows are added to the runtime.'
          : 'the bundle\'s rows stop running; the package stays installed.',
        '',
        await restartPreview(),
        '',
        pluginFooter(),
      ].join('\n'),
    )
  }

  const handlePlugin = async (message: TgMessage, rest: readonly string[]): Promise<void> => {
    const [sub = '', ...tail] = rest
    const argument = tail.join(' ').trim()
    switch (sub) {
      case 'list':
        return pluginList(message)
      case 'info':
        return argument.length === 0 ? reply(message, 'usage: `/plugin info <name>`') : pluginInfo(message, argument)
      case 'add':
      case 'install':
        return beginPluginInstall(message, argument)
      case 'remove':
      case 'rm':
        return argument.length === 0 ? reply(message, 'usage: `/plugin remove <name>`') : beginPluginRemove(message, argument)
      case 'enable':
        return argument.length === 0 ? reply(message, 'usage: `/plugin enable <name>`') : beginPluginBundle(message, argument, true)
      case 'disable':
        return argument.length === 0 ? reply(message, 'usage: `/plugin disable <name>`') : beginPluginBundle(message, argument, false)
      case 'confirm':
        return runPendingPlugin(message)
      case 'cancel':
        pendingPlugin = undefined
        return reply(message, 'dropped — nothing changed.')
      case 'approve':
        if (
          pendingPlugin === undefined ||
          pendingPlugin.action.kind !== 'install' ||
          pendingPlugin.action.approvedBuilds === undefined
        ) {
          return reply(message, 'no blocked build scripts are waiting — start with `/plugin add <spec>`.')
        }
        return runPendingPlugin(message)
      default:
        return reply(message, PLUGIN_USAGE)
    }
  }

  // --- topic helpers -------------------------------------------------------

  interface TopicCreation {
    threadId?: number
    error?: string
  }

  /** Telegram's own explanation, not a generic guess: the bot may have to show it. */
  const topicFailureText = (error: unknown): string => {
    if (error instanceof TelegramApiError) {
      return error.description.length === 0 ? `Telegram error ${String(error.errorCode ?? '')}` : error.description
    }
    return error instanceof Error ? error.message : String(error)
  }

  const noteTopicFailure = (error: unknown, action: string): void => {
    logger.warn(`dsh-telegram-connector: cannot ${action}: ${topicFailureText(error)}`)
  }

  const createTopic = async (
    chatId: number,
    title: string,
    rethrowRateLimit = false,
  ): Promise<TopicCreation> => {
    try {
      const topic = await client.createForumTopic(chatId, truncate(title, 128))
      return { threadId: topic.message_thread_id }
    } catch (error) {
      // /sync retries 429s itself; every other caller degrades as before.
      if (rethrowRateLimit && error instanceof TelegramApiError && error.errorCode === 429) throw error
      noteTopicFailure(error, 'create a topic')
      return { error: topicFailureText(error) }
    }
  }

  const renameTopic = async (chatId: number, threadId: number, title: string): Promise<void> => {
    try {
      await client.editForumTopic(chatId, threadId, truncate(title, 128))
    } catch (error) {
      noteTopicFailure(error, 'rename a topic')
    }
  }

  const deleteTopic = async (chatId: number, threadId: number): Promise<void> => {
    try {
      await client.deleteForumTopic(chatId, threadId)
    } catch (error) {
      noteTopicFailure(error, 'delete a topic')
    }
  }

  const closeTopic = async (chatId: number, threadId: number): Promise<void> => {
    try {
      await client.closeForumTopic(chatId, threadId)
    } catch (error) {
      noteTopicFailure(error, 'close a topic')
    }
  }

  const groupTitle = async (chatId: number, title: string): Promise<void> => {
    try {
      await client.setChatTitle(chatId, title)
    } catch (error) {
      // a group where the bot cannot change info is not fatal
      logger.warn(`dsh-telegram-connector: setChatTitle failed: ${String(error)}`)
    }
  }

  // --- streaming -----------------------------------------------------------

  const runtimeKey = (chatId: number, threadId: number): string => `${chatId}:${threadId}`

  const runtimeFor = (message: TgMessage, workspace: WorkspaceBinding, session: SessionBinding): TopicRuntime => {
    const threadId = message.message_thread_id ?? 0
    const key = runtimeKey(message.chat.id, threadId)
    const existing = runtimes.get(key)
    if (existing !== undefined) return existing
    const created: TopicRuntime = {
      chatId: message.chat.id,
      threadId,
      workspace,
      session,
      buffer: '',
      parts: [],
      partRich: [],
      reactionParts: new Map(),
      process: [],
    }
    runtimes.set(key, created)
    return created
  }

  /** Send one streamed chunk, preferring Telegram's native rich Markdown. */
  const sendStreamChunk = async (
    bot: BotHandle,
    runtime: TopicRuntime,
    chunk: string,
    index: number,
  ): Promise<TgMessage> => {
    if (runtime.richMode !== 'html') {
      try {
        const sent = await bot.client.sendRichMessage(runtime.chatId, toRichMarkdown(chunk), {
          threadId: runtime.threadId,
        })
        runtime.richMode = 'rich'
        runtime.partRich[index] = true
        return sent
      } catch (error) {
        if (!isRichRejected(error)) throw error
        runtime.richMode = 'html'
        logger.warn(`dsh-telegram-connector: rich messages rejected; using HTML: ${String(error)}`)
      }
    }
    const sent = await sendChunkVia(bot, runtime.chatId, runtime.threadId, chunk)
    runtime.partRich[index] = false
    return sent
  }

  /** Edit a streamed chunk in the mode it was sent in, with a plain-text last resort. */
  const editStreamChunk = async (
    bot: BotHandle,
    runtime: TopicRuntime,
    messageId: number,
    chunk: string,
    index: number,
  ): Promise<void> => {
    if (runtime.richMode !== 'html' && runtime.partRich[index] !== false) {
      try {
        await botPool.waitEdit(bot, runtime.chatId)
        await bot.client.editRichMessageText(runtime.chatId, messageId, toRichMarkdown(chunk))
        runtime.partRich[index] = true
        return
      } catch (error) {
        if (!isRichRejected(error)) throw error
        runtime.richMode = 'html'
        runtime.partRich[index] = false
        logger.warn(`dsh-telegram-connector: rich edit rejected; using HTML: ${String(error)}`)
      }
    }

    await botPool.waitEdit(bot, runtime.chatId)
    try {
      await bot.client.editMessageText(runtime.chatId, messageId, toTelegramHtml(chunk), { parseMode: 'HTML' })
    } catch (error) {
      if (error instanceof TelegramApiError && error.errorCode === 400) {
        await bot.client.editMessageText(runtime.chatId, messageId, toPlainText(chunk))
        return
      }
      throw error
    }
  }

  const isNotModified = (error: unknown): boolean =>
    error instanceof TelegramApiError && /message is not modified/i.test(error.description)

  const flushNow = async (runtime: TopicRuntime): Promise<void> => {
    const text = runtime.buffer
    if (text.trim().length === 0) return
    if (runtime.lastFlushed === text) return
    if (runtime.bot === undefined) {
      const bot = await botPool.reserve(runtime.chatId)
      if (bot === undefined) {
        logger.warn('dsh-telegram-connector: no bot is available to send this reply')
        return
      }
      runtime.bot = bot
    }
    const bot = runtime.bot
    const chunks = splitMessage(text)
    let failed = false
    for (const [index, chunk] of chunks.entries()) {
      const existing = runtime.parts[index]
      try {
        if (existing === undefined) {
          const sent = await sendStreamChunk(bot, runtime, chunk, index)
          runtime.parts[index] = sent.message_id
          markStreamingReaction(runtime, bot, sent.message_id)
          if (index === 0 && runtime.pendingTurnId !== undefined) {
            const id = runtime.pendingTurnId
            runtime.pendingTurnId = undefined
            void bridge.completeTurn(id)
          }
        } else {
          await editStreamChunk(bot, runtime, existing, chunk, index)
        }
      } catch (error) {
        if (!(error instanceof TelegramApiError)) logger.warn(`dsh-telegram-connector: flush failed: ${String(error)}`)
        if (!isNotModified(error)) failed = true
      }
    }
    if (!failed) runtime.lastFlushed = text
  }

  /** A timer and a turn end must never send the same chunk twice. */
  const flush = (runtime: TopicRuntime): Promise<void> => {
    runtime.flushChain = (runtime.flushChain ?? Promise.resolve())
      .then(() => flushNow(runtime))
      .catch((error: unknown) => {
        logger.warn(`dsh-telegram-connector: flush failed: ${String(error)}`)
      })
    return runtime.flushChain
  }

  const scheduleFlush = (runtime: TopicRuntime): void => {
    if (runtime.flushTimer !== undefined) return
    runtime.flushTimer = setTimeout(() => {
      runtime.flushTimer = undefined
      void flush(runtime)
    }, editIntervalMs)
  }

  /** Flush the tail of a turn and retire the streaming reaction. */
  const finishStream = async (runtime: TopicRuntime): Promise<void> => {
    if (runtime.flushTimer !== undefined) {
      clearTimeout(runtime.flushTimer)
      runtime.flushTimer = undefined
    }
    await flush(runtime)
    await clearStreamReactions(runtime)
  }

  const processMode = (): 'off' | 'summary' | 'live' => config.processMode ?? 'live'

  const sendProcessSummary = async (
    chatId: number,
    threadId: number,
    items: readonly ProcessItem[],
    heading?: string,
  ): Promise<void> => {
    if (items.length === 0) return
    const options = heading === undefined ? {} : { heading }
    try {
      if (botPool.isBlocked(botPool.main, chatId)) {
        await sendTo(chatId, threadId, formatProcessSummaryText(items, options))
        return
      }
      await botPool.takeMain(chatId)
      await botPool.main.client.sendRichMessage(chatId, formatProcessSummary(items, options), { threadId })
    } catch (error) {
      if (!isRichRejected(error)) logger.warn(`dsh-telegram-connector: process summary failed: ${String(error)}`)
      await sendTo(chatId, threadId, formatProcessSummaryText(items, options))
    }
  }

  const rememberProcessCard = (state: ProcessCardState): void => {
    if (state.messageId === undefined) return
    bindings.processCards = {
      ...(bindings.processCards ?? {}),
      [state.sessionId]: {
        chatId: state.chatId,
        threadId: state.threadId,
        messageId: state.messageId,
        rich: state.rich,
      },
    }
    void persist()
  }

  const forgetProcessCard = (sessionId: string): void => {
    if (bindings.processCards?.[sessionId] === undefined) return
    delete bindings.processCards[sessionId]
    void persist()
  }

  const sendProcessCardNow = async (
    state: ProcessCardState,
    markdown: string,
    plain: string,
  ): Promise<void> => {
    if (botPool.isBlocked(botPool.main, state.chatId)) {
      throw new Error('the main bot is rate-limited in this chat')
    }
    await botPool.takeMain(state.chatId)
    try {
      const sent = await botPool.main.client.sendRichMessage(state.chatId, markdown, { threadId: state.threadId })
      state.messageId = sent.message_id
      state.rich = true
    } catch (error) {
      if (!isRichRejected(error)) throw error
      const sent = await botPool.main.client.sendMessage(state.chatId, toTelegramHtml(plain), {
        threadId: state.threadId,
        parseMode: 'HTML',
      })
      state.messageId = sent.message_id
      state.rich = false
    }
    rememberProcessCard(state)
  }

  const editProcessCardNow = async (
    state: ProcessCardState,
    markdown: string,
    plain: string,
  ): Promise<void> => {
    if (state.messageId === undefined) {
      await sendProcessCardNow(state, markdown, plain)
      return
    }
    await botPool.waitEdit(botPool.main, state.chatId)
    if (state.rich) {
      try {
        await botPool.main.client.editRichMessageText(state.chatId, state.messageId, markdown)
        return
      } catch (error) {
        if (error instanceof TelegramApiError && isNotModified(error)) return
        if (!isRichRejected(error)) throw error
        state.rich = false
      }
    }
    try {
      await botPool.main.client.editMessageText(state.chatId, state.messageId, toTelegramHtml(plain), {
        parseMode: 'HTML',
      })
    } catch (error) {
      if (error instanceof TelegramApiError && isNotModified(error)) return
      if (error instanceof TelegramApiError && error.errorCode === 400) {
        await botPool.main.client.editMessageText(state.chatId, state.messageId, plain)
        return
      }
      throw error
    }
  }

  const updateProcessCard = (
    state: ProcessCardState,
    items: readonly ProcessItem[],
    final: boolean,
    heading?: string,
  ): Promise<void> => {
    if (items.length === 0) return Promise.resolve()
    state.lastTouched = Date.now()
    const options = heading === undefined ? {} : { heading }
    const markdown = final ? formatProcessSummary(items, options) : formatLiveProcess(items)
    const plain = final ? formatProcessSummaryText(items, options) : formatLiveProcess(items)
    state.chain = state.chain
      .then(async () => {
        state.lastTouched = Date.now()
        await editProcessCardNow(state, markdown, plain)
      })
      .catch((error: unknown) => {
        logger.warn(`dsh-telegram-connector: process card failed: ${String(error)}`)
      })
    return state.chain
  }

  const scheduleProcessCard = (state: ProcessCardState, items: readonly ProcessItem[]): void => {
    if (state.timer !== undefined || items.length === 0) return
    state.timer = setTimeout(() => {
      state.timer = undefined
      void updateProcessCard(state, items, false)
    }, editIntervalMs)
  }

  const finalizeProcessCard = async (
    state: ProcessCardState,
    items: readonly ProcessItem[],
    heading?: string,
  ): Promise<void> => {
    if (state.timer !== undefined) {
      clearTimeout(state.timer)
      state.timer = undefined
    }
    await updateProcessCard(state, items, true, heading)
    forgetProcessCard(state.sessionId)
  }

  /** Close every live card left in bindings, e.g. after a restart or on stop. */
  const closeAllProcessCards = async (text: string): Promise<void> => {
    const entries = Object.entries(bindings.processCards ?? {})
    if (entries.length === 0) return
    for (const [sessionId, ref] of entries) {
      let closed = false
      try {
        if (botPool.isBlocked(botPool.main, ref.chatId)) {
          logger.warn(`dsh-telegram-connector: process card ${sessionId} left open; the main bot is rate-limited in that chat`)
          continue
        }
        await botPool.takeMain(ref.chatId)
        await botPool.waitEdit(botPool.main, ref.chatId)
        if (ref.rich) {
          try {
            await botPool.main.client.editRichMessageText(ref.chatId, ref.messageId, text)
            closed = true
          } catch (error) {
            if (!isRichRejected(error) && !(error instanceof TelegramApiError && error.errorCode === 400)) throw error
          }
        }
        if (!closed) {
          await botPool.main.client.editMessageText(ref.chatId, ref.messageId, text)
          closed = true
        }
      } catch (error) {
        if (!(error instanceof TelegramApiError && error.errorCode === 400)) {
          logger.warn(`dsh-telegram-connector: cannot close process card ${sessionId}: ${String(error)}`)
        } else {
          closed = true
        }
      }
      if (closed) delete bindings.processCards?.[sessionId]
    }
    await persist()
  }

  const processCardFor = (runtime: TopicRuntime): ProcessCardState => {
    const existing = runtime.processCard
    if (existing !== undefined) return existing
    const created: ProcessCardState = {
      chatId: runtime.chatId,
      threadId: runtime.threadId,
      sessionId: runtime.session.sessionId,
      rich: true,
      chain: Promise.resolve(),
      lastTouched: Date.now(),
    }
    runtime.processCard = created
    return created
  }

  const beginProcessTurn = (runtime: TopicRuntime): void => {
    const previous = runtime.processCard
    const previousItems = runtime.process
    if (previous !== undefined) {
      if (previous.timer !== undefined) clearTimeout(previous.timer)
      if (previousItems.length > 0) {
        void finalizeProcessCard(previous, previousItems, '⚠️ Process interrupted')
      } else {
        forgetProcessCard(previous.sessionId)
      }
    }
    runtime.process = []
    runtime.processActive = true
    runtime.processCard = undefined
  }

  const recordProcessItem = (runtime: TopicRuntime, item: ProcessItem): void => {
    if (runtime.processActive !== true) return
    const index = runtime.process.findIndex((candidate) => candidate.id === item.id)
    if (index === -1) runtime.process.push(item)
    else runtime.process[index] = item
    if (processMode() === 'live') scheduleProcessCard(processCardFor(runtime), runtime.process)
  }

  const completeProcessItem = (
    runtime: TopicRuntime,
    id: string,
    status: 'done' | 'error',
    detail?: string,
  ): void => {
    if (runtime.processActive !== true) return
    const index = runtime.process.findIndex((candidate) => candidate.id === id)
    if (index === -1) return
    const current = runtime.process[index]
    if (current === undefined) return
    runtime.process[index] = { ...current, status, ...(detail === undefined ? {} : { detail }) }
    if (processMode() === 'live') scheduleProcessCard(processCardFor(runtime), runtime.process)
  }

  const finishProcessTurn = async (
    runtime: TopicRuntime,
    heading?: string,
  ): Promise<void> => {
    const active = runtime.processActive === true
    runtime.processActive = false
    const items = runtime.process
    const card = runtime.processCard
    runtime.process = []
    runtime.processCard = undefined
    if (!active || items.length === 0 || processMode() === 'off') return
    if (processMode() === 'live' && card !== undefined) {
      await finalizeProcessCard(card, items, heading ?? '✅ Process')
      return
    }
    await sendProcessSummary(runtime.chatId, runtime.threadId, items, heading)
  }

  const resetStream = (runtime: TopicRuntime): void => {
    void clearStreamReactions(runtime)
    const previousCard = runtime.processCard
    const previousItems = runtime.process
    if (previousCard !== undefined) {
      if (previousCard.timer !== undefined) clearTimeout(previousCard.timer)
      if (previousItems.length > 0) {
        void finalizeProcessCard(previousCard, previousItems, '⚠️ Process interrupted')
      } else if (previousCard.messageId !== undefined) {
        void updateProcessCard(
          previousCard,
          [{ id: 'reset', kind: 'tool', label: 'process view closed', status: 'error' }],
          true,
          '⚠️ Process interrupted',
        )
        forgetProcessCard(previousCard.sessionId)
      }
    }
    runtime.processCard = undefined
    runtime.buffer = ''
    runtime.parts = []
    runtime.partRich = []
    runtime.bot = undefined
    runtime.richMode = undefined
    runtime.lastFlushed = undefined
    runtime.process = []
    runtime.processActive = false
    if (runtime.flushTimer !== undefined) {
      clearTimeout(runtime.flushTimer)
      runtime.flushTimer = undefined
    }
  }

  /** Rename the DSH session behind a live agent (the service needs the session object). */
  const renameSession = (runtime: TopicRuntime, title: string): void => {
    const titles = serviceOf<{ rename(session: unknown, title: string): unknown }>(ctx, 'sessionTitle')
    if (titles === undefined || runtime.agent === undefined) return
    try {
      titles.rename(runtime.agent.session, title.slice(0, 128))
    } catch (error) {
      stderr(`session rename failed: ${String(error)}`)
    }
  }

  const ensureAgent = async (runtime: TopicRuntime): Promise<Agent> => {
    if (runtime.agent !== undefined) return runtime.agent

    const model = runtime.session.model
    const agentOptions: Record<string, string> = {}
    const provider = model?.provider ?? config.provider
    const chosen = model?.model ?? config.model
    if (provider !== undefined) agentOptions.provider = provider
    if (chosen !== undefined) agentOptions.model = chosen

    // A restart re-enters with a session id that is already persisted, and
    // create() refuses those ("session … already exists"). Resume is the
    // counterpart: it loads the stored log and continues the conversation.
    const sessionId = SessionId(runtime.session.sessionId)
    const presets = agentPresetService()
    const preset = presets === undefined ? undefined : await presets.resolve(config.agentPreset)
    stderr(preset === undefined
      ? 'agent preset: unavailable (agentPresets service not visible; session has base tools only)'
      : `agent preset: ${preset.id}${config.agentPreset === undefined ? ' (default)' : ''}`)
    let handle: Awaited<ReturnType<typeof agents.create>>
    try {
      handle = await agents.create({
        sessionId,
        meta: {
          cwd: runtime.workspace.path,
          ...(preset === undefined ? {} : { agentPreset: preset.id }),
        },
        agentOptions,
        setup: async (agentCtx: Context) => {
          installTelegramPrompt(agentCtx)
          if (presets !== undefined && preset !== undefined) await presets.mount(agentCtx, preset.id)
        },
      })
    } catch (error) {
      if (isOwnershipError(error)) throw new Error(OWNERSHIP_HINT)
      if (!/already exists/i.test(String(error))) throw error
      stderr(`resuming persisted session ${runtime.session.sessionId}`)
      try {
      handle = await agents.resume({
        resumeSessionId: sessionId,
        agentOptions,
        setup: async (agentCtx: Context, agent: Agent) => {
          installTelegramPrompt(agentCtx)
          if (presets === undefined) return
          // a resumed session keeps the preset it was created with
          const recorded = agent.session.header.agentPreset ?? config.agentPreset
          let resolved
          try {
            resolved = await presets.resolve(recorded)
          } catch (error) {
            stderr(`preset "${recorded}" is unavailable; falling back to the default: ${String(error)}`)
            resolved = await presets.resolve(config.agentPreset)
          }
          stderr(`agent preset: resumed with ${resolved.id}`)
          await presets.mount(agentCtx, resolved.id)
        },
      })
      } catch (error) {
        // resume takes the write handle too, and a closed tab may still hold it
        if (isOwnershipError(error)) throw new Error(OWNERSHIP_HINT)
        throw error
      }
    }
    runtime.agent = handle.agent
    runtime.dispose = () => handle.dispose()

    // the topic has a name; the fresh session has only a generated one
    const wanted = runtime.session.title ?? topicTitles.get(runtime.threadId)
    if (wanted !== undefined && wanted.trim().length > 0) {
      runtime.session.title = wanted.trim()
      renameSession(runtime, wanted.trim())
    }
    runtime.session.sessionId = String(handle.agent.session.id)
    setSession(bindings, runtime.chatId, runtime.threadId, runtime.session)
    await persist()

    // agents.create only mints the session; workspace membership is a separate
    // mutation (the web UI's session controller calls attachSession too). Without
    // it the session exists with the right cwd but the UI files it under
    // "Ungrouped". insertSessionBefore is not a substitute: it reorders only
    // already-accounted sessions.
    const registry = registryOf(ctx)
    const workspace = registry?.get?.(runtime.session.workspaceId)
    if (workspace !== undefined) {
      try {
        await workspace.attachSession(runtime.session.sessionId)
        runtime.attached = true
      } catch (error) {
        logger.warn(`dsh-telegram-connector: cannot attach session: ${String(error)}`)
        stderr(`attach session failed: ${String(error)}`)
      }
    }
    logger.info(`dsh-telegram-connector: topic ${runtimeKey(runtime.chatId, runtime.threadId)} → session ${runtime.session.sessionId}`)
    return handle.agent
  }

  const disposeRuntime = async (runtime: TopicRuntime): Promise<void> => {
    if (runtime.flushTimer !== undefined) clearTimeout(runtime.flushTimer)
    if (runtime.processCard?.timer !== undefined) clearTimeout(runtime.processCard.timer)
    runtime.processCard = undefined
    await flush(runtime)
    await clearStreamReactions(runtime)
    await runtime.dispose?.()
    runtime.agent = undefined
    runtime.dispose = undefined
    resetStream(runtime)
  }

  // --- workspace binding ---------------------------------------------------

  const linkFor = (workspaceId: string): string =>
    botUsername === undefined
      ? '(bot username unknown)'
      : `https://t.me/${botUsername}?startgroup=${STARTGROUP_PREFIX}${workspaceId}`

  const clearChatSessions = async (chatId: number): Promise<void> => {
    clearStagedForChat(chatId)
    for (const [threadId, bound] of sessionsOfChat(bindings, chatId)) {
      await deleteTopic(chatId, threadId)
      forgetProcessCard(bound.sessionId)
      removeSession(bindings, chatId, threadId)
      const runtime = runtimes.get(runtimeKey(chatId, threadId))
      if (runtime !== undefined) {
        await disposeRuntime(runtime)
        runtimes.delete(runtimeKey(chatId, threadId))
      }
    }
  }

  /** Attach a group to a workspace. Any previous content in that group is cleared. */
  const bindGroup = async (message: TgMessage, workspaceId: string): Promise<void> => {
    const workspace = bindings.workspaces[workspaceId]
    if (workspace === undefined) {
      return reply(message, `unknown workspace \`${workspaceId}\` — see /workspaces in the bot chat`)
    }

    // a workspace lives in exactly one group
    const previousChat = workspace.chatId
    const existingOwner = workspaceIdByChat(bindings, message.chat.id)
    if (existingOwner !== undefined && existingOwner !== workspaceId) {
      delete bindings.workspaces[existingOwner]
      await clearChatSessions(message.chat.id)
    }

    await clearChatSessions(message.chat.id)
    workspace.chatId = message.chat.id
    bindings.workspaces[workspaceId] = workspace
    await groupTitle(message.chat.id, workspace.title)
    await persist()
    if (previousChat !== message.chat.id && previousChat !== 0) {
      logger.info(`dsh-telegram-connector: workspace ${workspaceId} moved group ${previousChat} → ${message.chat.id}`)
    }
    await sendTo(message.chat.id, 0, dashboardText(workspaceId, workspace))
  }

  const dashboardText = (workspaceId: string, workspace: WorkspaceBinding): string => {
    const sessions = sessionsOfChat(bindings, workspace.chatId)
    const rows = sessions.length === 0
      ? '_no sessions yet_'
      : sessions
        .map(([threadId, session]) => `· \`${session.sessionId.slice(0, 18)}…\` — topic ${threadId}`)
        .join('\n')
    return [
      `**${workspace.title}**`,
      `path: \`${workspace.path}\``,
      `workspace: \`${workspaceId}\``,
      '',
      rows,
      '',
      '`/new [title]` start a session · `/sessions` refresh · `/status` · `/unbind`',
    ].join('\n')
  }

  // --- control plane (private chat) ---------------------------------------

  /** One help implementation for every surface; the registry lives in help.ts. */
  const showHelp = async (
    message: TgMessage,
    command: string,
    args: readonly string[],
    surface: Surface,
  ): Promise<void> => {
    const target = stripHelpFlag(args).join(' ').trim()
    if (command === '/man') {
      return reply(message, target.length === 0 ? manualText(surface) : (lookupText(target, surface) ?? unknownHelp(target)))
    }
    return reply(message, target.length === 0 ? indexText(surface) : (lookupText(target, surface) ?? unknownHelp(target)))
  }

  const handleControl = async (message: TgMessage, text: string): Promise<void> => {
    if (bindings.controlChatId !== message.chat.id) {
      bindings.controlChatId = message.chat.id
      await persist()
    }
    const [command, ...rest] = text.trim().split(/\s+/)
    const argument = rest.join(' ').trim()

    if (command === '/start' || command === '/help' || command === '/man') {
      return showHelp(message, command, rest, 'control')
    }
    if (hasHelpFlag(rest)) {
      return reply(message, lookupText([command ?? '', ...stripHelpFlag(rest)].join(' '), 'control') ?? indexText('control'))
    }

    if (command === '/workspaces') {
      const entries = Object.entries(bindings.workspaces)
      if (entries.length === 0) {
        return reply(message, 'no workspaces yet — `/workspace new <title>`')
      }
      const rows = entries.map(([id, workspace]) => {
        const group = workspace.chatId === 0 ? `no group — ${linkFor(id)}` : `group \`${workspace.chatId}\``
        return `· **${workspace.title}** — \`${id.slice(0, 8)}…\`\n   ${group}`
      })
      return reply(message, `**workspaces**\n${rows.join('\n')}`)
    }

    if (command === '/workspace') {
      const [sub, ...tail] = rest
      const target = tail.join(' ').trim()

      if (sub === 'new') {
        if (target.length === 0) return reply(message, 'usage: `/workspace new <title>`')
        const path = await createTopicWorkspace(workspaceRoot, target, 0)
        let workspaceId: string | undefined
        const controller = controllerOf(ctx)
        if (controller !== undefined) {
          try {
            workspaceId = (await controller.create({ path })).workspace.workspaceId
          } catch (error) {
            logger.warn(`dsh-telegram-connector: workspace registration failed: ${String(error)}`)
          }
        }
        const id = workspaceId ?? `local-${randomUUID().slice(0, 8)}`
        bindings.workspaces[id] = { chatId: 0, path, title: target }
        // the reply below carries the link, so the reconciler must not repeat it
        reminded.add(id)
        await persist()
        return reply(
          message,
          [
            `created **${target}**`,
            `path: \`${path}\``,
            `workspace: \`${id}\``,
            '',
            'add the bot to its group:',
            linkFor(id),
            '',
            'the group must have **Topics** enabled and the bot needs admin with *Manage Topics*.',
          ].join('\n'),
        )
      }

      if (sub === 'link') {
        const found = findWorkspace(bindings, target)
        if (found === undefined) return reply(message, `no workspace matching \`${target}\``)
        reminded.add(found[0])
        return reply(message, `**${found[1].title}**\n${linkFor(found[0])}`)
      }

      if (sub === 'rm') {
        const found = findWorkspace(bindings, target)
        if (found === undefined) return reply(message, `no workspace matching \`${target}\``)
        const controller = controllerOf(ctx)
        if (controller !== undefined) {
          await controller.delete({ workspaceId: found[0] }).catch((error: unknown) => {
            logger.warn(`dsh-telegram-connector: workspace delete failed: ${String(error)}`)
          })
        }
        if (found[1].chatId !== 0) await clearChatSessions(found[1].chatId)
        delete bindings.workspaces[found[0]]
        await persist()
        return reply(message, 'removed from DSH. The directory, its sessions and the group are untouched.')
      }

      return reply(message, 'usage: `/workspace new|link|rm …`')
    }

    if (command === '/plugins') return pluginList(message)
    if (command === '/plugin') return handlePlugin(message, rest)
    if (command === '/system') return handleSystem(message, rest)
    if (command === '/timezone') return setTimeZone(message, argument)
    if (command === '/reactions') return handleReactions(message, rest)
    if (command === '/about') return reply(message, await aboutText())
    if (command === '/schedules') return reply(message, '_automation surface lands in the next batch_')

    if (command === '/status') {
      const bound = Object.keys(bindings.workspaces).length
      const live = [...runtimes.values()].filter((runtime) => runtime.agent !== undefined).length
      return reply(
        message,
        [
          `model route: \`${config.provider ?? 'default'}/${config.model ?? 'default'}\``,
          `workspaces: ${bound}`,
          `sessions live: ${live}`,
          `poller: ${stopped ? 'stopped' : 'running'}`,
          `timezone: \`${timeZone()}\``,
          await supervisorLine(),
        ].join('\n'),
      )
    }

    return reply(message, `unknown command \`${command ?? ''}\` — /help`)
  }

  // --- group surfaces ------------------------------------------------------

  /** Resolve a session in this group by id prefix or topic title. */
  const findSessionOf = (chatId: number, needle: string): [number, SessionBinding] | undefined => {
    const query = needle.trim().toLowerCase()
    if (query.length === 0) return undefined
    const rows = sessionsOfChat(bindings, chatId)
    const hit =
      rows.find(([, bound]) => boundedPrefix(bound.sessionId, query)) ??
      rows.find(([, bound]) => (bound.title ?? '').toLowerCase() === query) ??
      rows.find(([, bound]) => (bound.title ?? '').toLowerCase().includes(query))
    return hit
  }

  const boundedPrefix = (id: string, prefix: string): boolean => id === prefix || id.startsWith(prefix)

  /** `/dangerous cleanup [confirm]`: drop known topics that are not sessions. */
  const runCleanup = async (
    message: TgMessage,
    workspaceId: string,
    workspace: WorkspaceBinding,
    threadId: number,
    rest: string[],
  ): Promise<void> => {
    if (rest[0] !== 'cleanup') {
      return reply(message, '`/dangerous cleanup` — delete every known topic in this group that is not a session')
    }
    const seen = workspace.seenThreads ?? []
    const unbound = seen.filter(
      (id) => id !== 0 && id !== threadId && sessionFor(bindings, message.chat.id, id) === undefined,
    )
    if (unbound.length === 0) {
      return reply(message, 'nothing to clean: every topic this group has shown me is a session')
    }
    if (rest[1] !== 'confirm') {
      return reply(
        message,
        [
          `would delete **${unbound.length}** topic(s): ${unbound.map((id) => `\`${id}\``).join(', ')}`,
          '',
          'send `/dangerous cleanup confirm` to proceed.',
          '_Telegram does not let a bot list topics, so this covers only topics this group has shown since the bot joined. Anything older has to go by hand._',
        ].join('\n'),
      )
    }
    let deleted = 0
    for (const id of unbound) {
      await deleteTopic(message.chat.id, id)
      removeSession(bindings, message.chat.id, id)
      runtimes.delete(runtimeKey(message.chat.id, id))
      deleted += 1
    }
    workspace.seenThreads = seen.filter((id) => !unbound.includes(id))
    bindings.workspaces[workspaceId] = workspace
    await persist()
    return reply(message, `deleted ${deleted} unbound topic(s)`)
  }

  /**
   * Replay the last few turns of an adopted session into its new topic. Live
   * events never re-fire, so without this a synced topic starts empty.
   */
  const backfill = async (
    chatId: number,
    threadId: number,
    sessionId: string,
    send: (chatId: number, threadId: number, markdown: string) => Promise<void> = sendTo,
  ): Promise<number> => {
    // readSession returns the complete replay-validated log; listEvents returns
    // body-free records, which is why parsing those found no text at all
    const query = serviceOf<{ readSession?: (id: string) => unknown }>(ctx, 'sessionQuery')
    if (query?.readSession === undefined) {
      stderr('backfill: no sessionQuery.readSession available')
      return 0
    }

    let events: unknown[] = []
    try {
      const read = query.readSession(sessionId)
      const log = read instanceof Promise ? await read : read
      if (Array.isArray(log)) events = log
      else if (log !== null && typeof log === 'object' && Array.isArray((log as { events?: unknown[] }).events)) {
        events = (log as { events: unknown[] }).events
      }
      stderr(`backfill: ${events.length} event(s) read for ${sessionId}`)
    } catch (error) {
      stderr(`backfill read failed: ${String(error)}`)
      return 0
    }

    type Block = { type: string; text?: string }
    type Ev = {
      type?: string
      data?: {
        message?: { content?: readonly Block[] }
        content?: readonly Block[]
        source?: { kind?: string }
      }
    }
    const quote = (text: string): string => text.split('\n').map((line) => `> ${line}`).join('\n')
    const lines: string[] = []
    for (const raw of events) {
      const ev = raw as Ev
      if (ev.type === 'user/message') {
        const text = promptText(ev.data)?.trim()
        if (text === undefined || text.length === 0) continue
        lines.push(`👤 **you (web)**\n\n${quote(text)}`)
      } else if (ev.type === 'assistant/message') {
        const text = messageText(ev.data?.message).trim()
        if (text.length === 0) continue
        // quote both sides: a transcript where only one speaker is indented reads
        // like two different kinds of content
        lines.push(`🤖 **assistant**\n\n${quote(text)}`)
      }
    }
    const tail = lines.slice(-20)
    if (tail.length === 0) return 0
    // one message, not twenty: Telegram caps ~20 messages per minute per group and
    // a per-session replay used to trip it, which silently ate the /sync reply too
    const body = [`🗂 **history** · last ${tail.length} message(s)`, '', ...tail].join('\n\n')
    await send(chatId, threadId, body)
    return tail.length
  }

  const handleDashboard = async (message: TgMessage, workspaceId: string, workspace: WorkspaceBinding): Promise<void> => {
    const [command, ...rest] = (message.text ?? '').trim().split(/\s+/)
    const argument = rest.join(' ').trim()

    if (command === '/help' || command === '/start' || command === '/man') {
      return showHelp(message, command, rest, 'dashboard')
    }
    if (hasHelpFlag(rest)) {
      return reply(message, lookupText([command ?? '', ...stripHelpFlag(rest)].join(' '), 'dashboard') ?? indexText('dashboard'))
    }

    if (command === '/status' && argument.length > 0) {
      const found = findSessionOf(message.chat.id, argument)
      if (found === undefined) {
        return reply(message, `no session matching \`${argument}\` — \`/sessions\` lists them.`)
      }
      const [threadId, bound] = found
      const runtime = runtimes.get(runtimeKey(message.chat.id, threadId))
      return reply(
        message,
        [
          `session: \`${bound.sessionId}\``,
          `title: ${bound.title ?? '—'}`,
          `topic: ${threadId}`,
          `workspace: \`${workspaceId}\``,
          `path: \`${workspace.path}\``,
          `model: \`${bound.model?.provider ?? config.provider ?? 'default'}/${bound.model?.model ?? config.model ?? 'default'}\``,
          `agent: ${runtime?.agent === undefined ? 'idle' : 'live'}`,
        ].join('\n'),
      )
    }

    if (command === '/sessions' || command === '/status') {
      return reply(message, dashboardText(workspaceId, workspace))
    }

    if (command === '/setsystem') {
      const thread = message.message_thread_id ?? 0
      if (sessionFor(bindings, message.chat.id, thread) !== undefined) {
        return reply(message, 'this topic is a session — pick a topic without a conversation to be the system topic')
      }
      workspace.systemThreadId = thread
      bindings.workspaces[workspaceId] = workspace
      await persist()
      return reply(
        message,
        `this topic is now the **system topic**. Every command lives here; session topics take plain text only.`,
      )
    }

    if (command === '/list') {
      if (rest[0] !== 'archived') return reply(message, '`/list archived` — sessions currently archived')
      const archived = (registryOf(ctx)?.archivedSessionIds ?? []).map(String)
      if (archived.length === 0) return reply(message, 'nothing archived')
      const shown = sessionsOfChat(bindings, message.chat.id).map(([, session]) => session.sessionId)
      const rows = archived.map((id) => `\`${id}\`${shown.includes(id) ? ' (has topic)' : ''}`)
      return reply(message, `**archived sessions**\n${rows.join('\n')}\n\n\`/unarchive <id>\` restores one and gives it a topic`)
    }

    if (command === '/unarchive') {
      const needle = (rest[0] ?? '').trim()
      const registry = registryOf(ctx)
      if (registry === undefined) return reply(message, 'this composition exposes no workspace registry')

      if (needle === 'all') {
        const ids = (registry.archivedSessionIds ?? []).map(String)
        if (ids.length === 0) return reply(message, 'nothing is archived')
        const known = new Set(sessionsOfChat(bindings, message.chat.id).map(([, bound]) => bound.sessionId))
        let restored = 0
        for (const id of ids) {
          try {
            await registry.unarchiveSession(id)
          } catch (error) {
            stderr(`unarchive ${id} failed: ${String(error)}`)
            continue
          }
          if (known.has(id)) continue
          const base = (await sessionTitleOf(id)) ?? `session ${id.slice(-6)}`
          const title = uniqueTitle(message.chat.id, base.slice(0, 120))
          const topic = await createTopic(message.chat.id, title)
          if (topic.threadId === undefined) break
          const threadId = topic.threadId
          setSession(bindings, message.chat.id, threadId, { workspaceId, sessionId: id, title })
          await persist()
          await backfill(message.chat.id, threadId, id)
          restored += 1
        }
        return reply(message, `restored ${ids.length} archived session(s), ${restored} new topic(s) created`)
      }
      const archived = (registry.archivedSessionIds ?? []).map(String)
      const match = needle.length === 0 ? undefined : archived.find((id) => id === needle || id.startsWith(needle))
      if (match === undefined) return reply(message, 'usage: `/unarchive <id from /list archived>`')
      try {
        await registry.unarchiveSession(match)
      } catch (error) {
        return reply(message, `cannot unarchive: ${String(error)}`)
      }
      const topic = await createTopic(message.chat.id, `session ${match.slice(-6)}`)
      if (topic.threadId === undefined) {
        return reply(message, `restored, but the topic could not be created: ${topic.error ?? 'unknown error'}`)
      }
      const threadId = topic.threadId
      setSession(bindings, message.chat.id, threadId, { workspaceId, sessionId: match, title: `session ${match.slice(-6)}` })
      await persist()
      await backfill(message.chat.id, threadId, match)
      return reply(message, `restored \`${match}\` as topic ${threadId} — \`/rename\` inside it to name it`)
    }

    if (command === '/rename' || command === '/forget' || command === '/model' || command === '/close' || command === '/reopen') {
      const [needle, ...tail] = rest
      const found = needle === undefined ? undefined : findSessionOf(message.chat.id, needle)
      if (found === undefined) {
        return reply(message, `no session matching \`${needle ?? ''}\` — \`/sync\` lists what exists, or use an id prefix / topic title`)
      }
      const [threadId, bound] = found
      const runtime = runtimes.get(runtimeKey(message.chat.id, threadId))

      if (command === '/rename') {
        const title = tail.join(' ').trim()
        if (title.length === 0) return reply(message, 'usage: `/rename <session> <new title>`')
        bound.title = title.slice(0, 120)
        setSession(bindings, message.chat.id, threadId, bound)
        await persist()
        if (runtime !== undefined) renameSession(runtime, bound.title)
        await renameTopic(message.chat.id, threadId, bound.title)
        return reply(message, `renamed to **${bound.title}**`)
      }

      if (command === '/forget') {
        if (runtime !== undefined) await disposeRuntime(runtime)
        clearStagedForTopic(message.chat.id, threadId)
        runtimes.delete(runtimeKey(message.chat.id, threadId))
        removeSession(bindings, message.chat.id, threadId)
        await persist()
        return reply(message, 'forgotten — the topic stays, the DSH session is untouched. `/dangerous cleanup` can delete it.')
      }

      if (command === '/model') {
        const [provider, model] = tail.join(' ').split('/')
        if (provider === undefined || provider.length === 0) {
          return reply(message, `usage: \`/model <session> <provider>/<model>\`\ncurrent: \`${bound.model?.provider ?? config.provider ?? 'default'}/${bound.model?.model ?? config.model ?? 'default'}\``)
        }
        bound.model = { provider, ...(model === undefined ? {} : { model }) }
        setSession(bindings, message.chat.id, threadId, bound)
        await persist()
        if (runtime !== undefined) await disposeRuntime(runtime)
        return reply(message, `model for \`${bound.sessionId.slice(-8)}\` set to \`${provider}${model === undefined ? '' : `/${model}`}\``)
      }

      const registry = registryOf(ctx)
      try {
        if (command === '/close') {
          await registry?.archiveSession(bound.sessionId, { stopActivity: true })
          await closeTopic(message.chat.id, threadId)
          clearStagedForTopic(message.chat.id, threadId)
        } else {
          await registry?.unarchiveSession(bound.sessionId)
          await client.reopenForumTopic(message.chat.id, threadId).catch(() => undefined)
        }
      } catch (error) {
        return reply(message, `cannot ${command === '/close' ? 'archive' : 'unarchive'}: ${String(error)}`)
      }
      return reply(message, `${command === '/close' ? 'archived' : 'restored'} \`${bound.sessionId.slice(-8)}\``)
    }

    if (command === '/sync') {
      const registry = registryOf(ctx)
      const target = registry?.get?.(workspaceId)
      if (target === undefined) return reply(message, 'this composition exposes no workspace registry')

      const archived = new Set((registry?.archivedSessionIds ?? []).map(String))
      let created = 0
      let skipped = 0
      let purged = 0
      let live = 0
      /** Sessions that still need a topic, kept in the workspace's manual order. */
      const pending: string[] = []

      // One notice per sync, in the system chat, the first time the pacing is
      // long enough to explain (or Telegram answers 429).
      let noticeSent = false
      const rateLimitNotice = async (): Promise<void> => {
        if (noticeSent) return
        noticeSent = true
        await sendTo(
          message.chat.id,
          workspace.systemThreadId ?? 0,
          'sync is rate-limited by telegram api, waiting for rate-limit to proceed, please wait',
          'control',
        )
      }

      const paused = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

      // Probes and topic creation must come from the main bot; they share its
      // general send budget through the pool.
      const paced = async <T>(call: () => Promise<T>): Promise<T> => {
        for (let attempt = 0; attempt < 6; attempt += 1) {
          if (botPool.mainWait(message.chat.id) >= 1500) await rateLimitNotice()
          await botPool.takeMain(message.chat.id)
          try {
            return await call()
          } catch (error) {
            if (error instanceof TelegramApiError && error.errorCode === 429) {
              await rateLimitNotice()
              botPool.block(botPool.main, message.chat.id, Math.max(1, error.retryAfter ?? 5) * 1000)
              continue
            }
            throw error
          }
        }
        throw new Error('Telegram did not lift the rate limit')
      }

      // Decide per session, not from a pre-computed "already known" set: a binding
      // is only worth keeping if its thread still answers, and that has to be
      // checked in the same pass that would otherwise skip the session.
      for (const raw of target.sessionIds) {
        const sessionId = String(raw)
        if (archived.has(sessionId)) {
          skipped += 1
          continue
        }

        const existing = sessionsOfChat(bindings, message.chat.id).find(([, bound]) => bound.sessionId === sessionId)
        if (existing !== undefined) {
          const [threadId] = existing
          let alive = true
          try {
            const probe = await paced(() => client.sendMessage(message.chat.id, '.', { threadId }))
            await deleteMessage(message.chat.id, probe.message_id).catch(() => undefined)
          } catch {
            alive = false
          }
          if (alive) {
            if (agents.get(SessionId(sessionId)) !== undefined) live += 1
            continue
          }
          removeSession(bindings, message.chat.id, threadId)
          runtimes.delete(runtimeKey(message.chat.id, threadId))
          purged += 1
          await persist()
        }

        pending.push(sessionId)
      }

      // Telegram lists topics newest first, so creating them in workspace order
      // would leave the group reading backwards. Create the last session first:
      // after the last backfill the group reads top-to-bottom like the UI, whose
      // sessionIds are in manual order. (Telegram orders the list by recency, so
      // this is a snapshot, not a setting.)
      let provisional = 0
      for (const sessionId of pending.reverse()) {
        const stored = await sessionTitleOf(sessionId)
        if (stored === undefined) provisional += 1
        const base = stored ?? `session ${sessionId.slice(-6)}`
        const title = uniqueTitle(message.chat.id, base.slice(0, 120))
        let topic: TopicCreation | undefined
        try {
          topic = await paced(() => createTopic(message.chat.id, title, true))
        } catch (error) {
          return reply(
            message,
            `⚠️ sync stopped while waiting for Telegram: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
        if (topic?.threadId === undefined) break
        const threadId = topic.threadId
        setSession(bindings, message.chat.id, threadId, { workspaceId, sessionId, title })
        await persist()
        await backfill(message.chat.id, threadId, sessionId)
        created += 1
        if (agents.get(SessionId(sessionId)) !== undefined) live += 1
      }

      return reply(
        message,
        [
          `adopted ${created}; ${skipped} archived skipped; ${purged} dead binding(s) replaced.`,
          live > 0 ? `${live} are open in a web UI: their topics mirror that tab, and Telegram prompts are refused until it closes.` : '',
          provisional > 0 ? `${provisional} had no title: name them with \`/rename <session> <title>\`.` : '',
        ]
          .filter((line) => line.length > 0)
          .join('\n'),
      )
    }

    if (command === '/dangerous') return runCleanup(message, workspaceId, workspace, 0, rest)

    if (command === '/new') {
      const sessionId = String(SessionId(randomUUID()))
      const title = argument.length > 0 ? argument : `session ${sessionId.slice(-6)}`
      const topic = await createTopic(message.chat.id, title)
      if (topic.threadId === undefined) {
        return reply(
          message,
          [
            'could not create the session topic.',
            topic.error === undefined ? '' : `Telegram: ${topic.error}`,
            'Check that the bot is an admin with `can_manage_topics` in this group, then try `/new` again.',
          ].filter((line) => line.length > 0).join('\n\n'),
        )
      }
      const threadId = topic.threadId
      setSession(bindings, message.chat.id, threadId, { workspaceId, sessionId, title })
      await persist()
      await sendTo(message.chat.id, threadId, `session \`${sessionId}\` ready — send a message to begin.`)
      return reply(message, `started **${title}** (topic ${threadId})`)
    }

    if (command === '/unbind') {
      await clearChatSessions(message.chat.id)
      delete bindings.workspaces[workspaceId]
      await persist()
      return reply(message, 'detached. The workspace still exists in DSH; the group is yours to keep or delete.')
    }

    if (command === '/plugins' || command === '/plugin') {
      return reply(message, 'plugins are profile-global — manage them in the private chat with the bot (`/plugins`).')
    }
    if (command === '/system') {
      return reply(message, 'system commands are profile-global — use the private chat with the bot (`/system status`).')
    }

    return reply(message, 'this is the workspace dashboard — `/new` to start a session, or open one of the topics.')
  }

  /** Make a topic title unique within its group: "x", "x (2)", "x (3)" … */
  const uniqueTitle = (chatId: number, base: string): string => {
    const taken = new Set(sessionsOfChat(bindings, chatId).map(([, bound]) => (bound.title ?? '').toLowerCase()))
    if (!taken.has(base.toLowerCase())) return base
    for (let n = 2; n < 100; n += 1) {
      const candidate = `${base} (${n})`
      if (!taken.has(candidate.toLowerCase())) return candidate
    }
    return base
  }

  /** The session's own title, when the query service can read one. */
  const sessionTitleOf = async (sessionId: string): Promise<string | undefined> => {
    const query = serviceOf<{ readTitle?: (id: string) => unknown }>(ctx, 'sessionQuery')
    if (query?.readTitle === undefined) return undefined
    try {
      const read = query.readTitle(sessionId)
      const value = read instanceof Promise ? await read : read
      if (typeof value === 'string') return value
      const title = (value as { title?: unknown } | null)?.title
      return typeof title === 'string' && title.trim().length > 0 ? title.trim() : undefined
    } catch {
      return undefined
    }
  }

  /** Telegram gives a bot no way to list topics, so we keep our own inventory. */
  const rememberThread = async (workspaceId: string, workspace: WorkspaceBinding, threadId: number): Promise<void> => {
    const seen = workspace.seenThreads ?? []
    if (seen.includes(threadId)) return
    workspace.seenThreads = [...seen, threadId]
    bindings.workspaces[workspaceId] = workspace
    await persist()
  }

  const handleSession = async (
    message: TgMessage,
    workspaceId: string,
    workspace: WorkspaceBinding,
    threadId: number,
    text: string,
    content?: readonly unknown[],
  ): Promise<void> => {
    // any topic without a session becomes one, so creating topics by hand works
    const existing = sessionFor(bindings, message.chat.id, threadId)
    const session: SessionBinding = existing ?? { workspaceId, sessionId: String(SessionId(randomUUID())) }
    if (existing === undefined) {
      setSession(bindings, message.chat.id, threadId, session)
      await persist()
    }

    const runtime = runtimeFor(message, workspace, session)

    try {
      const agent = await ensureAgent(runtime)
      await finishStream(runtime)
      resetStream(runtime)
      runtime.lastPrompt = text
      // Optimistic: this turn should be ours. If the runtime refuses it
      // because a web tab holds the handle, agent/error marks it foreign again.
      runtime.foreign = false
      void client.setTyping(message.chat.id, threadId)
      injected.set(runtime.session.sessionId, Date.now())
      const input = await bridge.recordInput(runtime.session.sessionId, text).catch((error: unknown) => {
        stderr(`bridge: cannot journal prompt: ${String(error)}`)
        return undefined
      })
      const blocks = content ?? [{ type: 'text', text }]
      agent.followup(createUserMessage({ content: blocks as never, source: { kind: 'user' } }))
      if (input !== undefined) await bridge.completeInput(input.id)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      // A runtime with no agent is a failed attempt, not a claimed topic: drop it
      // so the mirror can still reach this topic.
      if (runtime.agent === undefined) runtimes.delete(runtimeKey(runtime.chatId, runtime.threadId))
      await reply(message, `⚠️ ${detail}`)
    }
  }

  // --- session slash bridge ------------------------------------------------

  const hostCommandService = (): HostCommandService | undefined => serviceOf<HostCommandService>(ctx, 'commands')
  const skillListService = (): SkillListService | undefined => serviceOf<SkillListService>(ctx, 'skills')

  const topicRuntimeFor = async (
    message: TgMessage,
    workspaceId: string,
    workspace: WorkspaceBinding,
    threadId: number,
  ): Promise<TopicRuntime> => {
    const existing = sessionFor(bindings, message.chat.id, threadId)
    const session: SessionBinding = existing ?? {
      workspaceId,
      sessionId: String(SessionId(randomUUID())),
    }
    if (existing === undefined) {
      setSession(bindings, message.chat.id, threadId, session)
      await persist()
    }
    return runtimeFor(message, workspace, session)
  }

  const listUserSkills = async (workspace: WorkspaceBinding): Promise<readonly SkillSummaryView[] | undefined> => {
    const service = skillListService()
    if (service === undefined) return undefined
    try {
      const skills = await service.list({ cwd: workspace.path })
      return skills.filter((skill) => skill.invocation?.userInvocable === true)
    } catch (error) {
      logger.warn(`dsh-telegram-connector: cannot list skills: ${String(error)}`)
      return undefined
    }
  }

  const skillsText = async (workspace: WorkspaceBinding): Promise<string> => {
    const skills = await listUserSkills(workspace)
    if (skills === undefined) return 'the skills service is not available in this runtime.'
    if (skills.length === 0) return 'no user-invocable skills are installed for this workspace.'
    const lines = ['**skills**', '']
    for (const skill of [...skills].sort((left, right) => left.name.localeCompare(right.name))) {
      const description = skill.description === undefined ? '' : ` — ${truncate(skill.description, 160)}`
      lines.push(`• \`/${skill.name}\`${description}`)
    }
    lines.push('', 'Run `/<name>` to load one into the next turn. `/skill <name>` forces it when a host command owns the name.')
    return lines.join('\n')
  }

  const commandsText = async (runtime: TopicRuntime): Promise<string> => {
    const service = hostCommandService()
    if (service === undefined) return 'the commands service is not available in this runtime.'
    try {
      const agent = await ensureAgent(runtime)
      const commands = service.list(agent)
      if (commands.length === 0) return 'no host commands are registered for this session.'
      const lines = ['**commands**', '']
      for (const command of [...commands].sort((left, right) => left.name.localeCompare(right.name))) {
        const description = command.description === undefined ? '' : ` — ${truncate(command.description, 160)}`
        const hint = command.input?.hint === undefined ? '' : ` \`${command.input.hint}\``
        lines.push(`• \`/${command.name}\`${hint}${description}`)
      }
      lines.push('', 'Run `/name` in this topic; output stays out of the model history. `/run <name>` forces a host command when a connector command owns the name.')
      return lines.join('\n')
    } catch (error) {
      return `⚠️ cannot list commands: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  // --- inbound media -------------------------------------------------------

  const attachmentStore = (): AttachmentStoreLike | undefined =>
    serviceOf<AttachmentStoreLike>(ctx, 'attachments')

  const dedupeMedia = (items: readonly StagedMedia[]): StagedMedia[] => {
    const seen = new Set<string>()
    return items.filter((item) => {
      if (seen.has(item.fileId)) return false
      seen.add(item.fileId)
      return true
    })
  }

  const referenceStaged = (message: TgMessage, media: MediaDescriptor): StagedMedia => ({
    ...media,
    chatId: message.chat.id,
    threadId: message.message_thread_id ?? 0,
    userId: message.from?.id ?? 0,
    messageId: 0,
    createdAt: Date.now(),
  })

  const downloadAttachments = async (
    items: readonly StagedMedia[],
    label: 'new' | 'referenced' | 'attached' | 'forwarded',
  ): Promise<{ blocks: unknown[]; errors: string[] }> => {
    const attachments = attachmentStore()
    if (attachments === undefined) return { blocks: [], errors: ['attachments are not available in this runtime'] }
    const blocks: unknown[] = []
    const errors: string[] = []
    const prefix = label === 'new'
      ? 'New media'
      : label === 'referenced'
        ? 'Referenced media'
        : label === 'forwarded'
          ? 'Forwarded media'
          : 'Attached media'
    for (const item of items) {
      if (item.size !== undefined && item.size > MAX_TELEGRAM_DOWNLOAD) {
        errors.push(`${item.name} (${formatBytes(item.size)}) is larger than the 20 MB Bot API limit`)
        continue
      }
      try {
        const data = await client.downloadFile(item.fileId)
        blocks.push({ type: 'text', text: `${prefix}: ${item.name}` })
        if (item.kind === 'image' && isImageMediaType(item.mediaType)) {
          const ref = await attachments.saveImage({ data, mediaType: item.mediaType, name: item.name })
          blocks.push({ type: 'image', attachment: ref })
        } else {
          const ref = await attachments.saveFile({ data, name: item.name })
          blocks.push({ type: 'file', attachment: ref })
        }
      } catch (error) {
        errors.push(`${item.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return { blocks, errors }
  }

  /** Download every item and hand the agent one message with text + DSH blocks. */
  const processMediaPrompt = async (
    message: TgMessage,
    workspaceId: string,
    workspace: WorkspaceBinding,
    threadId: number,
    items: readonly StagedMedia[],
    text: string,
  ): Promise<void> => {
    void markPromptRead(message)
    if (attachmentStore() === undefined) {
      await reply(message, '⚠️ image/file attachments are not available in this runtime')
      return
    }
    const prompt = text.trim().length > 0 ? text.trim() : attachmentPlaceholder(items)
    const downloaded = await downloadAttachments(items, 'attached')
    const fullPrompt = downloaded.errors.length > 0
      ? `${prompt}\n\n[Attachment errors: ${downloaded.errors.join('; ')}]`
      : prompt
    await handleSession(message, workspaceId, workspace, threadId, fullPrompt, [
      { type: 'text', text: fullPrompt },
      ...downloaded.blocks,
    ])
  }

  /** A reply turn: the user's text or new media, plus the referenced message. */
  const handleReferenceTurn = async (
    message: TgMessage,
    workspaceId: string,
    workspace: WorkspaceBinding,
    threadId: number,
    userText: string,
    reference: ReplyReference,
    newItems: readonly StagedMedia[],
    currentMedia: boolean,
  ): Promise<void> => {
    void markPromptRead(message)
    const fresh = dedupeMedia(newItems)
    const referenced = dedupeMedia(reference.media.map((media) => referenceStaged(message, media)))
      .filter((item) => !fresh.some((candidate) => candidate.fileId === item.fileId))
    const needsAttachments = fresh.length > 0 || referenced.length > 0
    if (needsAttachments && attachmentStore() === undefined) {
      await reply(message, '⚠️ image/file attachments are not available in this runtime')
      return
    }

    const newDownload = needsAttachments
      ? await downloadAttachments(fresh, currentMedia ? 'new' : 'attached')
      : { blocks: [] as unknown[], errors: [] as string[] }
    const refDownload = needsAttachments
      ? await downloadAttachments(referenced, 'referenced')
      : { blocks: [] as unknown[], errors: [] as string[] }
    const prompt = currentMedia
      ? mediaReplyPrompt(userText, reference, refDownload.errors)
      : referencePrompt(userText, reference, refDownload.errors)
    const newErrors = newDownload.errors.map((error) => `New media could not be attached: ${error}.`)
    const fullPrompt = [prompt, ...newErrors].join('\n\n').trim()
    await handleSession(message, workspaceId, workspace, threadId, fullPrompt, [
      { type: 'text', text: fullPrompt },
      ...newDownload.blocks,
      ...refDownload.blocks,
    ])
  }

  /** A forwarded message is its own context turn; its media is re-downloaded. */
  const handleForwardedTurn = async (
    message: TgMessage,
    workspaceId: string,
    workspace: WorkspaceBinding,
    threadId: number,
    forward: ForwardedReference,
  ): Promise<void> => {
    void markPromptRead(message)
    const items = forward.media.map((media) => referenceStaged(message, media))
    if (items.length > 0 && attachmentStore() === undefined) {
      await reply(message, '⚠️ image/file attachments are not available in this runtime')
      return
    }
    const downloaded = items.length > 0
      ? await downloadAttachments(items, 'forwarded')
      : { blocks: [] as unknown[], errors: [] as string[] }
    const prompt = formatForwardedReference(forward, downloaded.errors)
    await handleSession(message, workspaceId, workspace, threadId, prompt, [
      { type: 'text', text: prompt },
      ...downloaded.blocks,
    ])
  }

  const takePendingGroupsFor = (chatId: number, threadId: number, userId: number): StagedMedia[] => {
    const items: StagedMedia[] = []
    for (const [key, group] of pendingGroups) {
      if (group.chatId !== chatId || group.threadId !== threadId || group.userId !== userId) continue
      if (group.timer !== undefined) clearTimeout(group.timer)
      pendingGroups.delete(key)
      items.push(...group.items.map(({ message, media }) => toStaged(message, media)))
    }
    return items
  }

  const flushMediaGroup = async (key: string): Promise<void> => {
    const group = pendingGroups.get(key)
    if (group === undefined) return
    pendingGroups.delete(key)
    if (group.timer !== undefined) clearTimeout(group.timer)

    const first = group.items[0]?.message
    if (first === undefined) return
    const workspaceId = workspaceIdByChat(bindings, group.chatId)
    if (workspaceId === undefined) {
      await reply(
        first,
        'this group is not attached to a workspace.\n`/bind <workspace id or title>` — or create one from the bot chat.',
      )
      return
    }
    const workspace = bindings.workspaces[workspaceId]
    if (workspace === undefined) return
    if (group.threadId === (workspace.systemThreadId ?? 0)) {
      await reply(first, 'attachments belong in a session topic — open one and send them there.')
      return
    }

    const captionItem = group.items.find((entry) => entry.media.caption.trim().length > 0)
    if (captionItem !== undefined) {
      const staged = takeStaged(stagedKey(group.chatId, group.threadId, group.userId))
      const items = [
        ...staged,
        ...group.items.map(({ message, media }) => toStaged(message, media)),
      ]
      const unescaped = unescapeLeadingSlash(captionItem.media.caption.trimStart())
      if (!unescaped.escaped && unescaped.text.startsWith('/')) {
        return handleSessionSlash(
          captionItem.message,
          workspaceId,
          workspace,
          group.threadId,
          unescaped.text,
          undefined,
          referenceOf(captionItem.message),
          items,
        )
      }
      await processMediaPrompt(
        captionItem.message,
        workspaceId,
        workspace,
        group.threadId,
        items,
        unescaped.text,
      )
      return
    }

    addStaged(group.items.map(({ message, media }) => toStaged(message, media)))
  }

  const queueMediaGroup = (message: TgMessage, media: MediaDescriptor): void => {
    const groupId = media.groupId
    if (groupId === undefined) return
    const userId = message.from?.id ?? 0
    const chatId = message.chat.id
    const threadId = message.message_thread_id ?? 0
    const key = `${chatId}:${threadId}:${userId}:${groupId}`
    let group = pendingGroups.get(key)
    if (group === undefined) {
      group = { key, chatId, threadId, userId, groupId, items: [] }
    }
    if (group.timer !== undefined) clearTimeout(group.timer)
    group.items.push({ message, media })
    group.timer = setTimeout(() => { void flushMediaGroup(key) }, MEDIA_GROUP_WINDOW_MS)
    pendingGroups.set(key, group)
  }

  const handleMediaMessage = async (
    message: TgMessage,
    workspaceId: string,
    workspace: WorkspaceBinding,
    threadId: number,
    media: MediaDescriptor,
  ): Promise<void> => {
    const userId = message.from?.id ?? 0
    if (media.groupId !== undefined) {
      queueMediaGroup(message, media)
      return
    }
    if (media.caption.trim().length > 0) {
      const pending = takePendingGroupsFor(message.chat.id, threadId, userId)
      const staged = takeStaged(stagedKey(message.chat.id, threadId, userId))
      await processMediaPrompt(
        message,
        workspaceId,
        workspace,
        threadId,
        [...staged, ...pending, toStaged(message, media)],
        media.caption,
      )
      return
    }
    addStaged([toStaged(message, media)])
  }

  // --- session slash bridge -----------------------------------------------

  const MEDIA_STAGED_NOTICE = '📎 media staged for the next prompt (commands don\'t take attachments).'

  /** Items a slash gesture owns: already staged + this album/message. */
  const takeSlashItems = (
    message: TgMessage,
    threadId: number,
    media: MediaDescriptor | undefined,
    groupItems: readonly StagedMedia[] | undefined,
    consumeStaged: boolean,
  ): StagedMedia[] => {
    const userId = message.from?.id ?? 0
    const key = stagedKey(message.chat.id, threadId, userId)
    const pending = groupItems === undefined ? takePendingGroupsFor(message.chat.id, threadId, userId) : []
    const staged = consumeStaged ? takeStaged(key) : []
    const current = media === undefined ? [] : [toStaged(message, media)]
    return [...staged, ...pending, ...(groupItems ?? []), ...current]
  }

  /** Commands cannot take attachments; keep the media for the next prompt. */
  const stageSlashMedia = async (
    message: TgMessage,
    threadId: number,
    media: MediaDescriptor | undefined,
    groupItems: readonly StagedMedia[] | undefined,
  ): Promise<void> => {
    const fresh = takeSlashItems(message, threadId, media, groupItems, false)
    if (fresh.length === 0) return
    addStaged(fresh)
    await reply(message, MEDIA_STAGED_NOTICE)
  }

  const handleSkillSlash = async (
    message: TgMessage,
    workspaceId: string,
    workspace: WorkspaceBinding,
    threadId: number,
    text: string,
    media: MediaDescriptor | undefined,
    reference: ReplyReference | undefined,
    groupItems: readonly StagedMedia[] | undefined,
  ): Promise<void> => {
    const items = takeSlashItems(message, threadId, media, groupItems, true)
    if (reference !== undefined) {
      return handleReferenceTurn(
        message,
        workspaceId,
        workspace,
        threadId,
        text,
        reference,
        items,
        items.length > 0,
      )
    }
    if (items.length > 0) {
      return processMediaPrompt(message, workspaceId, workspace, threadId, items, text)
    }
    return handleSession(message, workspaceId, workspace, threadId, text)
  }

  const skillByName = async (
    name: string,
    workspace: WorkspaceBinding,
  ): Promise<SkillSummaryView | undefined> => {
    const skills = await listUserSkills(workspace)
    return skills?.find((candidate) => candidate.name === name)
  }

  const hasHostCommand = async (runtime: TopicRuntime, name: string): Promise<boolean> => {
    const service = hostCommandService()
    if (service === undefined) return false
    try {
      const agent = await ensureAgent(runtime)
      return service.list(agent).some((command) => command.name === name)
    } catch (error) {
      logger.warn(`dsh-telegram-connector: cannot list commands: ${String(error)}`)
      return false
    }
  }

  const executeHostCommand = async (
    message: TgMessage,
    runtime: TopicRuntime,
    name: string,
    args: string,
    label: string,
    required: boolean,
  ): Promise<boolean> => {
    const service = hostCommandService()
    if (service === undefined) {
      if (required) await reply(message, 'the host command service is not available in this runtime.')
      return false
    }
    try {
      const agent = await ensureAgent(runtime)
      await finishStream(runtime)
      const line = `/${name}${args.length > 0 ? ` ${args}` : ''}`
      const execution = await service.execute(agent, line, [], AbortSignal.timeout(300_000))
      if (execution === undefined) {
        if (required) await reply(message, `no host command \`/${name}\`. See \`/commands\`.`)
        return required
      }
      const result = execution.result
      const body = result.text?.trim() ?? (result.kind === 'success' ? 'done' : 'command failed')
      const safeBody = result.kind === 'success' ? body : redactSecrets(body)
      await reply(message, `⚡ \`${label}\`\n\n${result.kind === 'success' ? '✅' : '⚠️'} ${safeBody}`)
      return true
    } catch (error) {
      const detail = redactPreview(error instanceof Error ? error.message : String(error))
      await reply(message, `⚠️ \`${label}\` failed: ${detail}`)
      return true
    }
  }

  const handleSessionSlash = async (
    message: TgMessage,
    workspaceId: string,
    workspace: WorkspaceBinding,
    threadId: number,
    text: string,
    media?: MediaDescriptor,
    reference?: ReplyReference,
    groupItems?: readonly StagedMedia[],
  ): Promise<void> => {
    void markPromptRead(message)
    const parsed = parseSlash(text)
    if (parsed === undefined) {
      await stageSlashMedia(message, threadId, media, groupItems)
      await reply(
        message,
        'that doesn\'t look like a command. Use `//text` to send a message starting with `/`, or `/help` for the session commands.',
      )
      return
    }
    const name = parsed.name

    if (name === 'help' || name === 'man' || name === 'start') {
      await stageSlashMedia(message, threadId, media, groupItems)
      const words = text.trim().split(/\s+/)
      await showHelp(message, `/${name}`, words.slice(1), 'session')
      return
    }
    if (name === 'commands') {
      await stageSlashMedia(message, threadId, media, groupItems)
      const runtime = await topicRuntimeFor(message, workspaceId, workspace, threadId)
      await reply(message, await commandsText(runtime))
      return
    }
    if (name === 'skills') {
      await stageSlashMedia(message, threadId, media, groupItems)
      await reply(message, await skillsText(workspace))
      return
    }
    if (name === 'run') {
      const [command, ...tail] = parsed.args.split(/\s+/).filter((part) => part.length > 0)
      if (command === undefined) {
        await stageSlashMedia(message, threadId, media, groupItems)
        await reply(message, 'usage: `/run <command> [args]` — see `/commands`.')
        return
      }
      await stageSlashMedia(message, threadId, media, groupItems)
      const runtime = await topicRuntimeFor(message, workspaceId, workspace, threadId)
      await executeHostCommand(message, runtime, command, tail.join(' '), `/run ${command}`, true)
      return
    }
    if (name === 'skill') {
      const [skillName, ...tail] = parsed.args.split(/\s+/).filter((part) => part.length > 0)
      if (skillName === undefined) {
        await stageSlashMedia(message, threadId, media, groupItems)
        await reply(message, 'usage: `/skill <name> [args]` — see `/skills`.')
        return
      }
      if (await skillByName(skillName, workspace) === undefined) {
        await stageSlashMedia(message, threadId, media, groupItems)
        await reply(message, `no user-invocable skill \`${skillName}\`. See \`/skills\`.`)
        return
      }
      const line = `/${skillName}${tail.length > 0 ? ` ${tail.join(' ')}` : ''}`
      await handleSkillSlash(message, workspaceId, workspace, threadId, line, media, reference, groupItems)
      return
    }
    if (isReservedConnectorCommand(name)) {
      await stageSlashMedia(message, threadId, media, groupItems)
      if (name === 'restart' || name === 'confirm' || name === 'rollback' || name === 'update' || name === 'plugin' || name === 'plugins') {
        await reply(message, 'that one is profile-global — the private chat with the bot has it.')
        return
      }
      await reply(
        message,
        `this is a session topic — connector commands live in the system topic. Try \`/commands\` or \`/skills\` here.`,
      )
      return
    }

    // A bare name prefers a host command; `/skill` above forces the skill.
    const runtime = await topicRuntimeFor(message, workspaceId, workspace, threadId)
    if (await hasHostCommand(runtime, name)) {
      await stageSlashMedia(message, threadId, media, groupItems)
      await executeHostCommand(message, runtime, name, parsed.args, `/${name}`, false)
      return
    }

    if (await skillByName(name, workspace) !== undefined) {
      // dsh-tool-skill recognizes the `/name` gesture on the resulting user
      // message and injects the skill instructions into that step.
      await handleSkillSlash(message, workspaceId, workspace, threadId, text, media, reference, groupItems)
      return
    }

    await stageSlashMedia(message, threadId, media, groupItems)
    await reply(
      message,
      `unknown command or skill \`/${name}\`. Try \`/commands\` for host commands, \`/skills\` for skills, or \`//text\` for a literal slash.`,
    )
  }

  // --- routing -------------------------------------------------------------

  const handleMessage = async (message: TgMessage): Promise<void> => {
    // Publisher bots post, they do not talk; ignore any bot-originated message.
    if (message.from?.is_bot === true) return
    const media = mediaDescriptor(message)
    const reference = referenceOf(message)
    const forwarded = forwardedReference(message)
    const rawText = message.text ?? media?.caption
    const normalized = forwarded !== undefined || rawText === undefined
      ? undefined
      : normalizeSlashInput(rawText, botUsername)
    if (normalized?.directedElsewhere === true) return
    let text = normalized?.text ?? message.text
    if (text !== undefined && message.text !== undefined) message.text = text
    if (media !== undefined && normalized !== undefined) media.caption = normalized.text

    if (bindings.update !== undefined) {
      const command = (text ?? media?.caption ?? '').trim()
      if (!/^\/(?:system\s+status|about|help|man|start)\b/.test(command)) {
        const now = Date.now()
        const last = blockedNotified.get(message.chat.id) ?? 0
        if (now - last > 60_000) {
          blockedNotified.set(message.chat.id, now)
          await reply(message, '⏳ system update pending — new requests are blocked; send this again after the update finishes.')
        }
        return
      }
    }

    // A prompt is "read" as soon as it passes authorization and the update gate.
    // The reaction is cosmetic and never blocks routing.
    if (text !== undefined) void markPromptRead(message)

    if (message.chat.type === 'private') {
      if (forwarded !== undefined) {
        return reply(message, 'forwarded messages are supported in session topics, not in this control chat.')
      }
      if (media !== undefined) {
        return reply(message, 'attachments are supported in session topics, not in this control chat.')
      }
      if (text === undefined) return
      return handleControl(message, text)
    }

    const threadId = message.message_thread_id ?? 0
    const workspaceId = workspaceIdByChat(bindings, message.chat.id)

    // closing a topic retires the session in DSH; reopening brings it back
    if (workspaceId !== undefined && (message.forum_topic_closed !== undefined || message.forum_topic_reopened !== undefined)) {
      const bound = sessionFor(bindings, message.chat.id, threadId)
      const registry = registryOf(ctx)
      if (bound !== undefined && registry !== undefined) {
        try {
          if (message.forum_topic_closed !== undefined) {
            await registry.archiveSession(bound.sessionId, { stopActivity: true })
            clearStagedForTopic(message.chat.id, threadId)
          } else {
            await registry.unarchiveSession(bound.sessionId)
          }
        } catch (error) {
          stderr(`archive toggle failed: ${String(error)}`)
        }
      }
      return
    }

    if (message.forum_topic_created !== undefined && threadId !== 0) {
      topicTitles.set(threadId, message.forum_topic_created.name)
      if (workspaceId !== undefined) {
        const created = bindings.workspaces[workspaceId]
        if (created !== undefined) await rememberThread(workspaceId, created, threadId)
      }
    }

    // the startgroup link delivers /start workspace_<id> inside the new group
    if (text !== undefined && text.startsWith('/start')) {
      const payload = text.split(/\s+/)[1]
      if (payload !== undefined && payload.startsWith(STARTGROUP_PREFIX)) {
        return bindGroup(message, payload.slice(STARTGROUP_PREFIX.length))
      }
      if (workspaceId === undefined) {
        return reply(
          message,
          'this group is not attached to a workspace.\n`/bind <workspace id or title>` — or create one from the bot chat.',
        )
      }
    }

    // a group renamed by hand renames the workspace
    if (message.new_chat_title !== undefined && workspaceId !== undefined) {
      const workspace = bindings.workspaces[workspaceId]
      if (workspace !== undefined && workspace.title !== message.new_chat_title) {
        workspace.title = message.new_chat_title.slice(0, 128)
        bindings.workspaces[workspaceId] = workspace
        const controller = controllerOf(ctx)
        if (controller !== undefined) {
          await controller.rename({ workspaceId, title: workspace.title }).catch((error: unknown) => {
            logger.warn(`dsh-telegram-connector: group rename failed: ${String(error)}`)
          })
        }
        await persist()
      }
      return
    }

    if (text === undefined && media === undefined && forwarded === undefined) return

    if (workspaceId === undefined) {
      if (text !== undefined && text.startsWith('/bind')) {
        const argument = text.trim().split(/\s+/).slice(1).join(' ').trim()
        const found = findWorkspace(bindings, argument)
        if (found === undefined) {
          return reply(message, `no workspace matching \`${argument}\` — check /workspaces in the bot chat`)
        }
        return bindGroup(message, found[0])
      }
      return reply(
        message,
        'this group is not attached to a workspace.\n`/bind <workspace id or title>` — or `/workspace new <title>` in the bot chat.',
      )
    }

    const workspace = bindings.workspaces[workspaceId]
    if (workspace === undefined) return

    // a topic renamed by hand renames the session's cached title
    const editedName = message.forum_topic_edited?.name
    if (editedName !== undefined) {
      const session = sessionFor(bindings, message.chat.id, threadId)
      if (session !== undefined && editedName.trim().length > 0 && session.title !== editedName.trim()) {
        session.title = editedName.trim()
        setSession(bindings, message.chat.id, threadId, session)
        const live = runtimes.get(runtimeKey(message.chat.id, threadId))
        if (live !== undefined) renameSession(live, session.title)
        await persist()
      }
      return
    }

    if (threadId !== 0) await rememberThread(workspaceId, workspace, threadId)

    const systemThread = workspace.systemThreadId ?? 0
    if (threadId === systemThread) {
      if (forwarded !== undefined) {
        return reply(message, 'forwarded messages belong in a session topic — open one and send them there.')
      }
      if (media !== undefined) {
        return reply(message, 'attachments belong in a session topic — open one and send them there.')
      }
      return handleDashboard(message, workspaceId, workspace)
    }

    if (forwarded !== undefined) {
      return handleForwardedTurn(message, workspaceId, workspace, threadId, forwarded)
    }

    // Albums are several updates; let the group debounce decide, then flush.
    if (media?.groupId !== undefined) {
      return handleMediaMessage(message, workspaceId, workspace, threadId, media)
    }

    const rawSession = text ?? media?.caption ?? ''
    const unescaped = unescapeLeadingSlash(rawSession)
    const sessionText = unescaped.text
    if (text !== undefined) text = sessionText
    if (media !== undefined) media.caption = sessionText

    if (!unescaped.escaped && sessionText.startsWith('/')) {
      // bootstrap: a topic that holds no conversation may claim itself as the
      // system topic, otherwise there is no way to create one off General
      if (/^\/setsystem\b/.test(sessionText) && sessionFor(bindings, message.chat.id, threadId) === undefined) {
        return handleDashboard(message, workspaceId, workspace)
      }
      return handleSessionSlash(
        message,
        workspaceId,
        workspace,
        threadId,
        sessionText,
        media,
        reference,
      )
    }
    if (media !== undefined) {
      if (reference !== undefined) {
        const userId = message.from?.id ?? 0
        const pending = takePendingGroupsFor(message.chat.id, threadId, userId)
        const staged = takeStaged(stagedKey(message.chat.id, threadId, userId))
        return handleReferenceTurn(
          message,
          workspaceId,
          workspace,
          threadId,
          media.caption,
          reference,
          [...staged, ...pending, toStaged(message, media)],
          true,
        )
      }
      return handleMediaMessage(message, workspaceId, workspace, threadId, media)
    }
    if (text === undefined) return

    const userId = message.from?.id ?? 0
    const pending = takePendingGroupsFor(message.chat.id, threadId, userId)
    const staged = takeStaged(stagedKey(message.chat.id, threadId, userId))
    if (reference !== undefined) {
      return handleReferenceTurn(
        message,
        workspaceId,
        workspace,
        threadId,
        text,
        reference,
        [...staged, ...pending],
        false,
      )
    }
    const attachments = [...staged, ...pending]
    if (attachments.length > 0) {
      return processMediaPrompt(message, workspaceId, workspace, threadId, attachments, text)
    }
    return handleSession(message, workspaceId, workspace, threadId, text)
  }

  // --- reconciler ----------------------------------------------------------

  const reconcileOnce = async (): Promise<void> => {
    if (reconciling || stopped) return
    reconciling = true
    try {
      const registry = registryOf(ctx)
      if (registry === undefined) return
      const entries = new Map(registry.list().map((entry) => [String(entry.id), entry]))

      for (const [id, workspace] of Object.entries(bindings.workspaces)) {
        const entry = entries.get(id)
        if (entry === undefined) {
          if (!reminded.has(id) && bindings.controlChatId !== undefined) {
            reminded.add(id)
            await replyInControl(`workspace \`${id.slice(0, 8)}…\` (${workspace.title}) is gone from DSH — \`/workspace rm\` to forget it`)
          }
          continue
        }
        if (workspace.chatId !== 0 && entry.title !== workspace.title) {
          workspace.title = entry.title
          bindings.workspaces[id] = workspace
          await groupTitle(workspace.chatId, workspace.title)
          await persist()
        }
        if (workspace.chatId === 0 && bindings.controlChatId !== undefined && !reminded.has(id)) {
          reminded.add(id)
          await replyInControl(`workspace **${workspace.title}** has no group yet:\n${linkFor(id)}`)
        }
      }
    } catch (error) {
      logger.warn(`dsh-telegram-connector: reconcile failed: ${String(error)}`)
    } finally {
      reconciling = false
    }
  }

  // --- lifecycle -----------------------------------------------------------

  const pollLoop = async (): Promise<void> => {
    while (!stopped) {
      try {
        const updates = await client.getUpdates(offset, pollTimeoutSeconds)
        for (const update of updates) {
          if (update.update_id >= offset) offset = update.update_id + 1
          const message = update.message
          if (message === undefined) {
            const query = update.callback_query
            if (query === undefined) continue
            if (query.data?.startsWith('upd:cancel:')) {
              await cancelUpdate(query)
              continue
            }
            if (staleUpdateBatch) {
              await client.answerCallbackQuery(query.id, 'update finished — send your request again').catch(() => undefined)
              continue
            }
            if (bindings.update !== undefined) {
              await client.answerCallbackQuery(query.id, 'system update pending').catch(() => undefined)
              continue
            }
            if (!isAllowed(query.from?.id)) {
              await client.answerCallbackQuery(query.id, 'not authorized').catch(() => undefined)
              continue
            }
            if (query.data?.startsWith('cmp:')) {
              await handleComponentButton(query)
              continue
            }
            await handleTrialButton(query)
            continue
          }
          if (
            message.text === undefined &&
            mediaDescriptor(message) === undefined &&
            message.rich_message === undefined &&
            message.forward_origin === undefined &&
            message.forward_from === undefined &&
            message.forward_from_chat === undefined &&
            message.forum_topic_edited === undefined &&
            message.new_chat_title === undefined &&
            message.forum_topic_created === undefined &&
            message.forum_topic_closed === undefined &&
            message.forum_topic_reopened === undefined
          ) {
            continue
          }
          if (!isAllowed(message.from?.id)) {
            stderr(`refused update from id=${String(message.from?.id)} chat=${message.chat.id} text=${JSON.stringify((message.text ?? '').slice(0, 40))}`)
            if (message.text !== undefined) {
              await reply(
                message,
                `⛔ You are not authorized to use this bot.\n\nyour id: \`${String(message.from?.id)}\``,
              ).catch(() => undefined)
            }
            continue
          }
          if (staleUpdateBatch) {
            if (message.text !== undefined && !staleUpdateNotified.has(message.chat.id)) {
              staleUpdateNotified.add(message.chat.id)
              await reply(message, '✅ the update finished — this request was not executed; send it again.').catch(() => undefined)
            }
            continue
          }
          await handleMessage(message)
        }
        if (staleUpdateBatch) {
          staleUpdateBatch = false
          staleUpdateNotified.clear()
        }
        if (offset !== bindings.lastUpdateId) {
          bindings.lastUpdateId = offset
          void persist()
        }
        lastErrorAt = 0
      } catch (error) {
        const now = Date.now()
        if (now - lastErrorAt > 30_000) {
          logger.warn(`dsh-telegram-connector: poll error: ${String(error)}`)
          lastErrorAt = now
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 2000))
      }
    }
  }

  /** Deliver turns that were journaled but never acknowledged (crash, outage). */
  const flushBridgeTurns = async (): Promise<void> => {
    const bySession = new Map<string, TurnRecord[]>()
    for (const turn of bridge.pendingTurns()) {
      const list = bySession.get(turn.sessionId) ?? []
      list.push(turn)
      bySession.set(turn.sessionId, list)
    }
    for (const [sessionId, turns] of bySession) {
      const found = bindingForSession(sessionId)
      if (found === undefined) {
        stderr(`bridge: ${turns.length} undelivered turn(s) for unbound session ${sessionId}`)
        continue
      }
      const shown = turns.slice(-10)
      const lines = [`🗂 **while the connector was away** · ${turns.length} turn(s)`]
      if (turns.length > shown.length) lines.push(`_(${turns.length - shown.length} earlier turn(s) omitted)_`)
      for (const turn of shown) {
        if (turn.user !== undefined) lines.push(`> **you**: ${turn.user.replace(/\s+/g, ' ').slice(0, 300)}`)
        lines.push(`> **assistant**: ${turn.assistant.replace(/\s+/g, ' ').slice(0, 700)}`)
      }
      // Enqueue first, then retire the journal: the digest is durable in the
      // outbox, so a crash cannot duplicate the catch-up on the next boot.
      let queued = true
      for (const chunk of splitMessage(lines.join('\n\n'))) {
        try {
          await outbox.enqueue({
            id: randomUUID(),
            chatId: found.chatId,
            threadId: found.threadId,
            text: chunk,
            priority: 'normal',
            createdAt: Date.now(),
          })
        } catch (error) {
          queued = false
          stderr(`bridge: cannot queue catch-up: ${String(error)}`)
          break
        }
      }
      if (queued) {
        for (const turn of turns) await bridge.completeTurn(turn.id)
      }
    }
  }

  /** Re-inject prompts that were journaled but never acknowledged. */
  const replayBridgeInputs = async (): Promise<void> => {
    for (const input of bridge.pendingInputs()) {
      const found = bindingForSession(input.sessionId)
      if (found === undefined) continue
      const workspace = bindings.workspaces[found.bound.workspaceId]
      if (workspace === undefined) continue
      const pseudo = {
        chat: { id: found.chatId, type: 'supergroup' },
        message_thread_id: found.threadId,
        message_id: 0,
      } as TgMessage
      const runtime = runtimeFor(pseudo, workspace, found.bound)
      try {
        const agent = await ensureAgent(runtime)
        await finishStream(runtime)
        resetStream(runtime)
        runtime.lastPrompt = input.text
        injected.set(input.sessionId, Date.now())
        agent.followup(createUserMessage({ content: [{ type: 'text', text: input.text }], source: { kind: 'user' } }))
        await bridge.completeInput(input.id)
      } catch (error) {
        stderr(`bridge: cannot replay prompt ${input.id}: ${String(error)}`)
      }
    }
  }

  let publisherTimer: NodeJS.Timeout | undefined
  const reportedMissing = new Set<string>()
  const reportedInvalid = new Set<string>()

  /** Resolve publisher identities and check they are members of every bound group. */
  const validatePublishers = async (): Promise<void> => {
    for (const bot of botPool.bots) {
      if (bot.main || bot.disabled === true) continue
      if (bot.id !== undefined) continue
      try {
        const me = await bot.client.getMe()
        bot.id = me.id
        bot.username = me.username
        // stderr, not the harness logger: this is what `docker compose logs` shows
        stderr(`${bot.label} connected as @${me.username ?? me.id}`)
      } catch (error) {
        bot.disabled = true
        stderr(`${bot.label} token is unusable: ${String(error)}`)
        if (bindings.controlChatId !== undefined && !reportedInvalid.has(bot.label)) {
          reportedInvalid.add(bot.label)
          await sendTo(
            bindings.controlChatId,
            0,
            `⚠️ ${bot.label}'s token is unusable — check \`DSH_TELEGRAM_PUBLISHER_TOKENS\`.`,
            'control',
          )
        }
      }
    }

    const membership = new Map<string, { present: number; missing: number }>()
    for (const workspace of Object.values(bindings.workspaces)) {
      if (workspace.chatId === 0) continue
      for (const bot of botPool.bots) {
        if (bot.main || bot.disabled === true || bot.id === undefined) continue
        try {
          const member = await client.getChatMember(workspace.chatId, bot.id)
          const present = member.status === 'member'
            || member.status === 'administrator'
            || member.status === 'creator'
          botPool.markMissing(bot, workspace.chatId, !present)
          const stats = membership.get(bot.label) ?? { present: 0, missing: 0 }
          if (present) stats.present += 1
          else stats.missing += 1
          membership.set(bot.label, stats)
          const key = `${workspace.chatId}:${bot.label}`
          if (present) {
            reportedMissing.delete(key)
            continue
          }
          if (reportedMissing.has(key)) continue
          reportedMissing.add(key)
          const who = bot.username === undefined ? bot.label : `@${bot.username}`
          await sendTo(
            workspace.chatId,
            workspace.systemThreadId ?? 0,
            `⚠️ ${who} (${bot.label}) is not in this group — add it as a member to raise the rate limit (20 messages/min per bot).`,
            'control',
          )
        } catch (error) {
          stderr(`membership check failed for ${bot.label}: ${String(error)}`)
        }
      }
    }

    for (const bot of botPool.bots) {
      if (bot.main || bot.disabled === true) continue
      const stats = membership.get(bot.label)
      if (stats === undefined) continue
      const total = stats.present + stats.missing
      if (total === 0) stderr(`${bot.label}: no bound groups yet`)
      else stderr(`${bot.label}: member of ${stats.present}/${total} bound group(s)`)
    }
  }

  const start = async (): Promise<void> => {
    bindings = await loadBindings(file)
    startStagedSweep()
    startProcessCardSweep()
    await closeAllProcessCards('⚠️ Connector restarted — process view closed.')
      .catch((error: unknown) => stderr(`cannot close stale process cards: ${String(error)}`))
    offset = bindings.lastUpdateId ?? 0
    if (bindings.update !== undefined) {
      // The runtime was restarted by the updater. The first poll batch is what
      // arrived while dsh was down: answer it once, do not execute it.
      const pending = bindings.update
      staleUpdateBatch = true
      delete bindings.update
      drainState = undefined
      await persist()
      stderr('setup update completed; the first queued batch will be rejected')
      // The updater normally reports directly; if its Bot API call failed, it
      // leaves result.json behind for this boot to report.
      setTimeout(() => { void reportStoredUpdate(pending) }, 5000)
      const pendingMessageId = pending.messageId
      if (pendingMessageId !== undefined) {
        void botPool.waitEdit(botPool.main, pending.chatId)
          .then(() => client.editMessageText(
            pending.chatId,
            pendingMessageId,
            'setup update restarted — waiting for the updater result.',
            { replyMarkup: { inline_keyboard: [] } },
          ))
          .catch(() => undefined)
      }
    }
    await loadRateStats()
    await bridge.start().catch((error: unknown) => stderr(`bridge recovery failed: ${String(error)}`))
    await outbox.start().catch((error: unknown) => stderr(`outbox recovery failed: ${String(error)}`))
    // start listening first: getMe only feeds the startgroup link, and waiting on
    // it (slow network at boot) used to leave the bot deaf for a minute
    stderr(
      botPool.bots.length > 1
        ? `bots: main + ${botPool.bots.length - 1} publisher(s)`
        : 'bots: main only (set DSH_TELEGRAM_PUBLISHER_TOKENS to add senders)',
    )
    void pollLoop()
    void announceTrial()
    void flushBridgeTurns().catch((error: unknown) => stderr(`bridge flush failed: ${String(error)}`))
    void replayBridgeInputs().catch((error: unknown) => stderr(`bridge replay failed: ${String(error)}`))
    void validatePublishers().catch((error: unknown) => stderr(`publisher validation failed: ${String(error)}`))
    if (botPool.bots.length > 1) {
      publisherTimer = setInterval(() => {
        void validatePublishers().catch((error: unknown) => stderr(`publisher validation failed: ${String(error)}`))
      }, 6 * 60 * 60 * 1000)
    }
    void client
      .getMe()
      .then((me) => {
        botUsername = me.username
        logger.info(`dsh-telegram-connector: @${me.username ?? me.id} connected`)
        stderr(`connected as @${me.username ?? me.id}`)
      })
      .catch((error: unknown) => {
        logger.warn(`dsh-telegram-connector: cannot reach Telegram: ${String(error)}`)
        stderr(`getMe failed: ${String(error)}`)
      })
    if (reconcileIntervalMs > 0) {
      // never let a background tick become an unhandled rejection: cordis treats
      // that as a fatal load failure and takes the whole runtime down
      reconcileTimer = setInterval(() => {
        void reconcileOnce().catch((error: unknown) => {
          logger.warn(`dsh-telegram-connector: reconcile tick failed: ${String(error)}`)
        })
      }, reconcileIntervalMs)
    }
  }

  const stop = async (): Promise<void> => {
    stopped = true
    stopStagedSweep()
    stopProcessCardSweep()
    for (const runtime of runtimes.values()) {
      if (runtime.processCard?.timer !== undefined) clearTimeout(runtime.processCard.timer)
      runtime.processActive = false
      runtime.process = []
      runtime.processCard = undefined
    }
    for (const state of mirrorProcesses.values()) {
      if (state.timer !== undefined) clearTimeout(state.timer)
    }
    mirrorProcesses.clear()
    await closeAllProcessCards('⚠️ Connector stopped — process view closed.')
      .catch((error: unknown) => stderr(`cannot close process cards: ${String(error)}`))
    for (const group of pendingGroups.values()) {
      if (group.timer !== undefined) clearTimeout(group.timer)
    }
    pendingGroups.clear()
    for (const items of stagedMedia.values()) unmarkStaged(items)
    stagedMedia.clear()
    if (reconcileTimer !== undefined) clearInterval(reconcileTimer)
    if (publisherTimer !== undefined) clearInterval(publisherTimer)
    for (const timer of queueStatusTimers.values()) clearTimeout(timer)
    queueStatusTimers.clear()
    await Promise.all([...runtimes.values()].map((runtime) => disposeRuntime(runtime)))
    runtimes.clear()
    await Promise.race([
      outbox.stop(),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ])
    await persist()
  }

  /** sessionId → topic, for sessions this connector did not create (web UI ones). */
  const bindingForSession = (sessionId: string): { chatId: number; threadId: number; bound: SessionBinding } | undefined => {
    for (const [key, bound] of Object.entries(bindings.sessions)) {
      if (bound.sessionId !== sessionId) continue
      const [chat, thread] = key.split(':')
      return { chatId: Number(chat), threadId: Number(thread), bound }
    }
    return undefined
  }

  /**
   * Mirror a conversation driven elsewhere (the web UI) into its topic.
   *
   * Events arrive in log order but each send is asynchronous; a per-topic queue
   * keeps the prompt ahead of the answer it produced. The topic is checked again
   * when the task runs, because a Telegram turn may have claimed the session
   * while an earlier mirror was still being written to the outbox.
   */
  const mirrorQueue = new MirrorQueue((error: unknown) => {
    stderr(`mirror: ${String(error)}`)
  })
  const mirror = (sessionId: string, text: string, fromUser: boolean): void => {
    const found = bindingForSession(sessionId)
    if (found === undefined) return
    // Thread ids are only unique inside one group; matching on the thread alone
    // would drop a General-topic mirror whenever another group has one.
    const claimed = (): boolean => claimsTopic(
      [...runtimes.values()].map((candidate) => ({
        chatId: candidate.chatId,
        threadId: candidate.threadId,
        hasAgent: candidate.agent !== undefined,
        foreign: candidate.foreign === true,
      })),
      found.chatId,
      found.threadId,
    )
    if (claimed()) return
    const name = bindings.workspaces[found.bound.workspaceId]?.title ?? 'workspace'
    const markdown = fromUser ? `💬 **you (web)** · ${name}\n${text}` : text
    const key = `${found.chatId}:${found.threadId}`
    void mirrorQueue.enqueue(key, async () => {
      if (claimed()) return
      await sendTo(found.chatId, found.threadId, markdown)
    })
  }

  /**
   * A live process card for a session driven elsewhere (the web UI). Telegram
   * sessions use the collapsed summary instead; the mirror has no streaming
   * answer to attach one to, so the card is the progress surface.
   */
  interface MirrorProcess extends ProcessCardState {
    items: ProcessItem[]
    turnActive: boolean
    turnStarted: boolean
  }
  const mirrorProcesses = new Map<string, MirrorProcess>()

  const mirrorProcessFor = (sessionId: string): MirrorProcess | undefined => {
    if (processMode() === 'off') return undefined
    const found = bindingForSession(sessionId)
    if (found === undefined) return undefined
    const claimed = (): boolean => [...runtimes.values()]
      .some((candidate) => candidate.chatId === found.chatId && candidate.threadId === found.threadId)
    if (claimed()) {
      const existing = mirrorProcesses.get(sessionId)
      if (existing !== undefined) {
        if (existing.timer !== undefined) clearTimeout(existing.timer)
        if (existing.messageId !== undefined) {
          void updateProcessCard(existing, existing.items, true, '⚠️ Process view moved to Telegram')
        }
        forgetProcessCard(sessionId)
        mirrorProcesses.delete(sessionId)
      }
      return undefined
    }
    let state = mirrorProcesses.get(sessionId)
    if (state === undefined) {
      state = {
        sessionId,
        chatId: found.chatId,
        threadId: found.threadId,
        items: [],
        rich: true,
        turnActive: false,
        turnStarted: false,
        chain: Promise.resolve(),
        lastTouched: Date.now(),
      }
      mirrorProcesses.set(sessionId, state)
    }
    return state
  }

  const scheduleMirrorProcess = (state: MirrorProcess): void => {
    if (processMode() === 'live') scheduleProcessCard(state, state.items)
  }

  const recordMirrorProcess = (sessionId: string, item: ProcessItem): void => {
    const state = mirrorProcessFor(sessionId)
    if (state === undefined) return
    if (state.turnActive !== true) {
      state.turnActive = true
      state.turnStarted = false
      state.items = []
    }
    const index = state.items.findIndex((candidate) => candidate.id === item.id)
    if (index === -1) state.items.push(item)
    else state.items[index] = item
    state.lastTouched = Date.now()
    scheduleMirrorProcess(state)
  }

  const completeMirrorProcess = (
    sessionId: string,
    id: string,
    status: 'done' | 'error',
    detail?: string,
  ): void => {
    const state = mirrorProcesses.get(sessionId)
    if (state === undefined) return
    const index = state.items.findIndex((candidate) => candidate.id === id)
    if (index === -1) return
    const current = state.items[index]
    if (current === undefined) return
    state.items[index] = { ...current, status, ...(detail === undefined ? {} : { detail }) }
    state.lastTouched = Date.now()
    scheduleMirrorProcess(state)
  }

  const startMirrorTurn = (sessionId: string): void => {
    const state = mirrorProcessFor(sessionId)
    if (state === undefined) return
    state.turnActive = true
    state.turnStarted = true
    state.items = []
    state.lastTouched = Date.now()
  }

  const finishMirrorTurn = async (sessionId: string, heading?: string): Promise<void> => {
    const state = mirrorProcesses.get(sessionId)
    if (state === undefined) return
    if (state.timer !== undefined) {
      clearTimeout(state.timer)
      state.timer = undefined
    }
    state.turnActive = false
    if (state.items.length > 0) {
      if (processMode() === 'live') {
        await updateProcessCard(state, state.items, true, heading ?? '✅ Process')
      } else {
        await sendProcessSummary(state.chatId, state.threadId, state.items, heading)
      }
    }
    forgetProcessCard(sessionId)
    mirrorProcesses.delete(sessionId)
  }

  sweepMirrorCards = (): void => {
    const now = Date.now()
    for (const [sessionId, state] of mirrorProcesses) {
      if (state.turnActive !== true) continue
      if (now - state.lastTouched < PROCESS_CARD_TTL_MS) continue
      state.items = state.items.map((item) => item.status === 'running'
        ? { ...item, status: 'error' as const, detail: 'timed out' }
        : item)
      void finishMirrorTurn(sessionId, '⚠️ Process interrupted')
    }
  }

  ctx.on('session/event', (session, event: SessionEvent) => {
    const owner = [...runtimes.values()].find((candidate) => candidate.agent?.session === session)
    if (owner !== undefined && owner.foreign !== true) {
      const sessionId = String((session as { id?: unknown }).id ?? '')
      if (event.type === 'user/message' && sessionId.length > 0) {
        const pending = injected.get(sessionId)
        if (pending !== undefined) injected.delete(sessionId)
        const source = (event.data as { source?: { kind?: string } }).source
        if (isForeignPrompt(pending !== undefined, source?.kind)) {
          owner.foreign = true
          stderr(`session ${sessionId} is driven elsewhere; mirroring it instead of streaming`)
        }
      }
    }
    if (owner === undefined || owner.foreign === true) {
      const sessionId = String((session as { id?: unknown }).id ?? '')
      if (sessionId.length === 0) return
      const eventType = (event as { type: string }).type
      if (eventType === 'turn/start') {
        startMirrorTurn(sessionId)
        return
      }
      if (eventType === 'turn/end') {
        void finishMirrorTurn(sessionId)
        return
      }
      if (event.type === 'tool/call') {
        recordMirrorProcess(sessionId, {
          id: `tool:${String(event.data.callId)}`,
          kind: 'tool',
          label: toolLabel(event.data.name, event.data.arguments),
          status: 'running',
        })
        return
      }
      if (event.type === 'tool/result') {
        const reason = event.data.error?.reason
        completeMirrorProcess(
          sessionId,
          `tool:${String(event.data.message.toolCallId)}`,
          event.data.message.isError === true ? 'error' : 'done',
          reason === undefined ? undefined : redactPreview(reason),
        )
        return
      }
      if (eventType === 'command/run') {
        const data = (event as unknown as { data: { commandId?: unknown; name?: unknown; args?: unknown } }).data
        if (typeof data.name === 'string') {
          recordMirrorProcess(sessionId, {
            id: `command:${String(data.commandId)}`,
            kind: 'command',
            label: commandLabel(data.name, typeof data.args === 'string' ? data.args : undefined),
            status: 'running',
          })
        }
        return
      }
      if (eventType === 'command/done') {
        const data = (event as unknown as { data: { commandId?: unknown; kind?: string; text?: unknown } }).data
        completeMirrorProcess(
          sessionId,
          `command:${String(data.commandId)}`,
          data.kind === 'success' ? 'done' : 'error',
          data.kind === 'success' ? undefined : redactPreview(typeof data.text === 'string' ? data.text : 'command failed'),
        )
        const state = mirrorProcesses.get(sessionId)
        if (state !== undefined && state.turnStarted !== true) void finishMirrorTurn(sessionId)
        return
      }
      if (event.type === 'user/message') {
        const source = (event.data as { source?: { kind?: string; name?: string } }).source
        if (source?.kind === 'skill-invocation' && typeof source.name === 'string') {
          recordMirrorProcess(sessionId, {
            id: `skill:${source.name}:${String((event as { seq?: unknown }).seq ?? Date.now())}`,
            kind: 'skill',
            label: skillLabel(source.name),
            status: 'done',
          })
          return
        }
        const pending = injected.get(sessionId)
        if (pending !== undefined) {
          injected.delete(sessionId)
          return
        }
        // Only a human prompt is mirrored. DSH also records injected model
        // context (time readings, skill content, notices) as user/message.
        const text = promptText(event.data)
        if (text !== undefined) mirror(sessionId, text, true)
        return
      }
      if (event.type === 'assistant/message') {
        const text = messageText(event.data.message)
        if (text.length > 0) mirror(sessionId, text, false)
      }
      return
    }

    // attach may fail right after create if the session header is not persisted
    // yet; by the end of the first turn it certainly is
    if (event.type !== 'assistant/message') {
      const eventType = (event as { type: string }).type
      if (eventType === 'turn/start') {
        beginProcessTurn(owner)
        return
      }
      if (event.type === 'tool/call') {
        recordProcessItem(owner, {
          id: `tool:${String(event.data.callId)}`,
          kind: 'tool',
          label: toolLabel(event.data.name, event.data.arguments),
          status: 'running',
        })
        return
      }
      if (event.type === 'tool/result') {
        const callId = String(event.data.message.toolCallId)
        const reason = event.data.error?.reason
        completeProcessItem(
          owner,
          `tool:${callId}`,
          event.data.message.isError === true ? 'error' : 'done',
          reason === undefined ? undefined : redactPreview(reason),
        )
        return
      }
      if (eventType === 'command/run') {
        const data = (event as unknown as { data: { commandId?: unknown; name?: unknown; args?: unknown } }).data
        if (typeof data.name === 'string') {
          recordProcessItem(owner, {
            id: `command:${String(data.commandId)}`,
            kind: 'command',
            label: commandLabel(data.name, typeof data.args === 'string' ? data.args : undefined),
            status: 'running',
          })
        }
        return
      }
      if (eventType === 'command/done') {
        const data = (event as unknown as { data: { commandId?: unknown; kind?: string; text?: unknown } }).data
        completeProcessItem(
          owner,
          `command:${String(data.commandId)}`,
          data.kind === 'success' ? 'done' : 'error',
          data.kind === 'success' ? undefined : redactPreview(typeof data.text === 'string' ? data.text : 'command failed'),
        )
        return
      }
      if (event.type === 'user/message') {
        const source = (event.data as { source?: { kind?: string; name?: string } }).source
        if (source?.kind === 'skill-invocation' && typeof source.name === 'string') {
          recordProcessItem(owner, {
            id: `skill:${source.name}:${String((event as { seq?: unknown }).seq ?? Date.now())}`,
            kind: 'skill',
            label: skillLabel(source.name),
            status: 'done',
          })
        }
        return
      }
      if ((event as { type: string }).type === 'turn/end') {
        const text = owner.buffer.trim()
        if (text.length > 0) {
          // Journal the turn; if the live message was sent, it is already delivered.
          void bridge.recordTurn(owner.session.sessionId, text, owner.lastPrompt)
            .then((turn) => {
              if (owner.parts.length > 0) {
                // the live message already exists; the turn is delivered
                void bridge.completeTurn(turn.id)
                return
              }
              owner.pendingTurnId = turn.id
            })
            .catch((error: unknown) => stderr(`bridge: cannot record turn: ${String(error)}`))
        }
        // The final assistant chunk may still be waiting for the edit timer.
        // Flush it and only then retire the streaming reaction and summarize.
        void (async () => {
          await finishStream(owner)
          await finishProcessTurn(owner)
        })()
      }
      if ((event as { type: string }).type !== 'turn/end' || owner.attached === true) return
      const registry = registryOf(ctx)
      void registry
        ?.get?.(owner.session.workspaceId)
        ?.attachSession(owner.session.sessionId)
        .then(() => {
          owner.attached = true
        })
        .catch((error: unknown) => stderr(`attach retry failed: ${String(error)}`))
      return
    }
    const runtime = owner
    const text = event.data.message.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .filter((part) => part.length > 0)
      .join('\n')
    if (text.length === 0) return
    runtime.buffer = runtime.buffer.length === 0 ? text : `${runtime.buffer}\n\n${text}`
    scheduleFlush(runtime)
  })

  ctx.on('agent/error', (payload: { agent: Agent; error: unknown }) => {
    const message = payload.error instanceof Error ? payload.error.message : String(payload.error)
    const runtime = [...runtimes.values()].find((candidate) => candidate.agent === payload.agent)
    if (runtime !== undefined) {
      if (/active write handle|already owned/i.test(message)) {
        // Another client holds the session. Mirror it, and say so instead of
        // rendering this as a mysterious interrupted turn.
        runtime.foreign = true
        void (async () => {
          await finishStream(runtime)
          await finishProcessTurn(runtime, '↪️ Session moved to the web UI')
        })()
        void sendTo(
          runtime.chatId,
          runtime.threadId,
          'this session is open in a web UI tab, so prompts from Telegram are refused until it closes. This topic now mirrors that tab.',
        )
        return
      }
      if (runtime.processActive === true) {
        runtime.process = runtime.process.map((item) => item.status === 'running'
          ? { ...item, status: 'error' as const, detail: redactPreview(message) }
          : item)
      }
      void (async () => {
        await finishStream(runtime)
        await finishProcessTurn(runtime, '⚠️ Process interrupted')
      })()
      void sendTo(runtime.chatId, runtime.threadId, `⚠️ Agent error: ${message}`)
      return
    }

    const sessionId = String((payload.agent as unknown as { session?: { id?: unknown } }).session?.id ?? '')
    if (sessionId.length === 0) return
    const mirrorState = mirrorProcesses.get(sessionId)
    if (mirrorState === undefined) return
    mirrorState.items = mirrorState.items.map((item) => item.status === 'running'
      ? { ...item, status: 'error' as const, detail: redactPreview(message) }
      : item)
    void finishMirrorTurn(sessionId, '⚠️ Process interrupted')
  })

  ctx.effect(() => {
    void start()
    return () => {
      void stop()
    }
  })
}
