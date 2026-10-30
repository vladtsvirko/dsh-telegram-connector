/**
 * The per-chat outbox.
 *
 * Telegram allows about 20 messages a minute per bot per group, and every topic
 * shares that budget. This queue is the one place that spends it: FIFO, control
 * notices first, persisted one small file per item, and delivered exactly once
 * whenever the send result is observable.
 *
 * Exactly-once caveat: if the process dies between Telegram accepting a message
 * and us deleting its file, the item is moved to `lost/` rather than retried —
 * a duplicate is worse than a miss we can report.
 *
 * @module dsh-telegram-connector/outbox
 */

import { mkdir, open, readdir, readFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { BotPool, type BotHandle } from './bots.js'
import { hasTable, toPlainText, toRichMarkdown, toTelegramHtml } from './render.js'
import { TelegramApiError, isRichRejected } from './telegram.js'

export type ItemPriority = 'control' | 'normal'

export interface OutboxItem {
  id: string
  chatId: number
  threadId: number
  /** Telegram-flavoured markdown; converted at send time. */
  text: string
  priority: ItemPriority
  /** Control messages with buttons must come from the main bot. */
  pinnedMain?: boolean
  createdAt: number
  /** Called after Telegram acknowledges the send; not persisted. */
  onSent?: (id: string) => void
}

export interface OutboxOptions {
  dir: string
  pool: BotPool
  maxItemsPerChat?: number
  onDepth?: (chatId: number, depth: number) => void
  onSaturation?: (chatId: number, waitMs: number, depth: number) => void
  onLost?: (item: OutboxItem, reason: string) => void
  logger?: (line: string) => void
}

interface ChatQueue {
  control: OutboxItem[]
  normal: OutboxItem[]
}

const SATURATION_WAIT_MS = 30_000

export class Outbox {
  private readonly dir: string
  private readonly pool: BotPool
  private readonly maxItems: number
  private readonly onDepth?: (chatId: number, depth: number) => void
  private readonly onSaturation?: (chatId: number, waitMs: number, depth: number) => void
  private readonly onLost?: (item: OutboxItem, reason: string) => void
  private readonly logger: (line: string) => void
  private readonly queues = new Map<number, ChatQueue>()
  private readonly running = new Set<number>()
  private closed = false

  constructor(options: OutboxOptions) {
    this.dir = options.dir
    this.pool = options.pool
    this.maxItems = options.maxItemsPerChat ?? 300
    this.onDepth = options.onDepth
    this.onSaturation = options.onSaturation
    this.onLost = options.onLost
    this.logger = options.logger ?? (() => undefined)
  }

  private chatDir(chatId: number): string {
    return join(this.dir, String(chatId))
  }

  private fileName(item: OutboxItem, state: 'pending' | 'sending'): string {
    const kind = item.priority === 'control' ? 'c' : 'n'
    return `${state}-${kind}-${String(item.createdAt).padStart(16, '0')}-${item.id}.json`
  }

  private pathOf(item: OutboxItem, state: 'pending' | 'sending'): string {
    return join(this.chatDir(item.chatId), this.fileName(item, state))
  }

  /** Load persisted items; anything caught mid-send is ambiguous and is not retried. */
  async start(): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    for (const entry of await readdir(this.dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const chatId = Number(entry.name)
      if (!Number.isFinite(chatId)) continue
      const dir = join(this.dir, entry.name)
      const files = (await readdir(dir)).sort()
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        try {
          const item = JSON.parse(await readFile(join(dir, file), 'utf8')) as OutboxItem
          if (file.startsWith('sending-')) {
            await this.quarantine(item, 'process stopped while sending', join(dir, file))
            continue
          }
          this.push(item)
        } catch (error) {
          this.logger(`outbox: cannot read ${file}: ${String(error)}`)
        }
      }
      this.schedule(chatId)
    }
  }

  private queue(chatId: number): ChatQueue {
    let queue = this.queues.get(chatId)
    if (queue === undefined) {
      queue = { control: [], normal: [] }
      this.queues.set(chatId, queue)
    }
    return queue
  }

  private depth(chatId: number): number {
    const queue = this.queues.get(chatId)
    return queue === undefined ? 0 : queue.control.length + queue.normal.length
  }

  private push(item: OutboxItem): void {
    const queue = this.queue(item.chatId)
    if (item.priority === 'control') queue.control.push(item)
    else queue.normal.push(item)
    queue.control.sort((a, b) => a.createdAt - b.createdAt)
    queue.normal.sort((a, b) => a.createdAt - b.createdAt)

    const total = this.depth(item.chatId)
    if (total > this.maxItems) {
      const dropped = queue.normal.shift() ?? queue.control.shift()
      if (dropped !== undefined) {
        void this.quarantine(dropped, 'queue full').catch(() => undefined)
      }
    }
  }

  private next(chatId: number): OutboxItem | undefined {
    const queue = this.queues.get(chatId)
    return queue?.control.shift() ?? queue?.normal.shift()
  }

  private requeueFront(item: OutboxItem): void {
    const queue = this.queue(item.chatId)
    if (item.priority === 'control') queue.control.unshift(item)
    else queue.normal.unshift(item)
  }

  async enqueue(item: OutboxItem): Promise<void> {
    await mkdir(this.chatDir(item.chatId), { recursive: true })
    const temporary = `${this.pathOf(item, 'pending')}.tmp`
    const handle = await open(temporary, 'w', 0o600)
    try {
      await handle.writeFile(JSON.stringify(item))
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, this.pathOf(item, 'pending'))
    this.push(item)
    this.reportDepth(item.chatId)
    this.schedule(item.chatId)
  }

  private reportDepth(chatId: number): void {
    this.onDepth?.(chatId, this.depth(chatId))
  }

  private schedule(chatId: number): void {
    if (this.closed || this.running.has(chatId)) return
    if (this.depth(chatId) === 0) {
      this.reportDepth(chatId)
      return
    }
    this.running.add(chatId)
    void this.drain(chatId)
      .catch((error: unknown) => this.logger(`outbox: ${String(error)}`))
      .finally(() => {
        this.running.delete(chatId)
        if (!this.closed && this.depth(chatId) > 0) this.schedule(chatId)
      })
  }

  private async drain(chatId: number): Promise<void> {
    while (!this.closed) {
      const item = this.next(chatId)
      if (item === undefined) {
        this.reportDepth(chatId)
        return
      }
      this.reportDepth(chatId)
      await this.deliver(item)
    }
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private async chooseBot(item: OutboxItem): Promise<BotHandle | undefined> {
    if (item.pinnedMain === true) {
      await this.pool.takeMain(item.chatId)
      return this.pool.main
    }
    const wait = this.pool.nextWait(item.chatId)
    if (Number.isFinite(wait) && wait >= SATURATION_WAIT_MS) {
      this.onSaturation?.(item.chatId, wait, this.depth(item.chatId))
    }
    return this.pool.reserve(item.chatId)
  }

  private async deliver(item: OutboxItem): Promise<void> {
    const bot = await this.chooseBot(item)
    if (bot === undefined) {
      if (!Number.isFinite(this.pool.nextWait(item.chatId))) {
        await this.quarantine(item, 'no bot is available in this chat')
        return
      }
      // Still rate-limited rather than gone: keep the item and try again.
      this.requeueFront(item)
      await this.pause(1000)
      return
    }

    const pending = this.pathOf(item, 'pending')
    const sending = this.pathOf(item, 'sending')
    try {
      await rename(pending, sending)
    } catch (error) {
      this.logger(`outbox: cannot claim ${pending}: ${String(error)}`)
      return
    }

    try {
      await this.send(bot, item)
      await unlink(sending).catch(() => undefined)
      item.onSent?.(item.id)
    } catch (error) {
      if (error instanceof TelegramApiError && error.errorCode === 429) {
        this.pool.block(bot, item.chatId, Math.max(1, error.retryAfter ?? 5) * 1000)
        await rename(sending, pending).catch(() => undefined)
        this.requeueFront(item)
        return
      }
      if (this.isMembershipError(error)) {
        this.pool.markMissing(bot, item.chatId, true)
        this.pool.block(bot, item.chatId)
        await rename(sending, pending).catch(() => undefined)
        this.requeueFront(item)
        return
      }
      if (this.isDefinite(error)) {
        await this.quarantine(item, `telegram refused it: ${String(error)}`, sending)
        return
      }
      // Ambiguous: the message may or may not have been sent. Never retry.
      await this.quarantine(item, `outcome unknown: ${String(error)}`, sending)
    }
  }

  private async send(bot: BotHandle, item: OutboxItem): Promise<void> {
    // Rich messages are the only way to get native tables out of Telegram.
    // Anything the API rejects falls back to the HTML subset, and a rejected
    // HTML payload falls back to plain text rather than raw Markdown.
    if (hasTable(item.text)) {
      try {
        await bot.client.sendRichMessage(item.chatId, toRichMarkdown(item.text), { threadId: item.threadId })
        return
      } catch (error) {
        if (!isRichRejected(error)) throw error
        this.logger(`outbox: rich message rejected, falling back to HTML: ${String(error)}`)
      }
    }

    const html = toTelegramHtml(item.text)
    try {
      await bot.client.sendMessage(item.chatId, html, { threadId: item.threadId, parseMode: 'HTML' })
    } catch (error) {
      // Same fallback as the direct sender: bad entities become plain text once.
      if (error instanceof TelegramApiError && error.errorCode === 400 && !this.isMembershipError(error)) {
        await bot.client.sendMessage(item.chatId, toPlainText(item.text), { threadId: item.threadId })
        return
      }
      throw error
    }
  }

  private isMembershipError(error: unknown): boolean {
    if (!(error instanceof TelegramApiError) || error.errorCode !== 400 && error.errorCode !== 403) return false
    const text = `${error.description}`.toLowerCase()
    return text.includes('not a member')
      || text.includes('chat not found')
      || text.includes('was kicked')
      || text.includes('not enough rights')
      || text.includes('bot is not a member')
  }

  /** 4xx we can trust; 5xx and transport failures leave the outcome unknown. */
  private isDefinite(error: unknown): boolean {
    return error instanceof TelegramApiError
      && error.errorCode !== undefined
      && error.errorCode >= 400
      && error.errorCode < 500
      && error.errorCode !== 429
  }

  private async quarantine(item: OutboxItem, reason: string, file?: string): Promise<void> {
    const lostDir = join(this.chatDir(item.chatId), 'lost')
    await mkdir(lostDir, { recursive: true })
    const target = join(lostDir, `${this.fileName(item, 'sending')}.lost`)
    const candidates = file === undefined
      ? [this.pathOf(item, 'sending'), this.pathOf(item, 'pending')]
      : [file]
    for (const source of candidates) {
      try {
        await rename(source, target)
        break
      } catch {
        // try the other state, or leave it to the callback below
      }
    }
    this.onLost?.(item, reason)
    this.reportDepth(item.chatId)
  }

  /** Wait until every queue is empty (shutdown, tests). */
  async flush(): Promise<void> {
    for (;;) {
      const busy = [...this.queues.values()].some((queue) => queue.control.length + queue.normal.length > 0)
      if (!busy && this.running.size === 0) return
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }

  async stop(): Promise<void> {
    this.closed = true
    await this.flush()
  }
}
