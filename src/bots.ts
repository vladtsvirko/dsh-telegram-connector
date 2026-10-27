/**
 * The publisher pool.
 *
 * The main bot polls, owns buttons and creates topics. Publisher bots only
 * post. Each bot has its own 20/minute and one/second budget per group, so a
 * group's ceiling is roughly `bots × 20` sends a minute — provided every bot is
 * a member of that group.
 *
 * @module dsh-telegram-connector/bots
 */

import { ChatRateLimiter } from './rate-limit.js'
import type { TelegramClient } from './telegram.js'

export interface BotHandle {
  /** `main`, `publisher 1`, … — used in logs and reports. */
  label: string
  client: TelegramClient
  main: boolean
  id?: number
  username?: string
  /** Excluded after a failed getMe or a removed token. */
  disabled?: boolean
}

export interface BotPoolOptions {
  perMinute?: number
  intervalMs?: number
  editIntervalMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const BLOCK_MS = 60 * 60 * 1000

export class BotPool {
  readonly bots: BotHandle[]
  private readonly perMinute: number
  private readonly intervalMs: number
  private readonly editIntervalMs: number
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly sendLimiters = new Map<number, ChatRateLimiter>()
  private readonly editLimiters = new Map<number, ChatRateLimiter>()
  /** `${botIndex}:${chatId}` → blocked until. */
  private readonly blocked = new Map<string, number>()
  /** Bots confirmed absent from a chat; skipped until the next membership check. */
  private readonly missing = new Set<string>()

  constructor(bots: BotHandle[], options: BotPoolOptions = {}) {
    if (bots.length === 0) throw new Error('BotPool needs at least one bot')
    this.bots = bots
    this.perMinute = options.perMinute ?? 20
    this.intervalMs = options.intervalMs ?? 1100
    this.editIntervalMs = options.editIntervalMs ?? 1100
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  get main(): BotHandle {
    const main = this.bots.find((bot) => bot.main)
    if (main === undefined) throw new Error('BotPool has no main bot')
    return main
  }

  private indexOf(bot: BotHandle): number {
    const index = this.bots.indexOf(bot)
    if (index < 0) throw new Error(`unknown bot ${bot.label}`)
    return index
  }

  private key(bot: BotHandle, chatId: number): string {
    return `${this.indexOf(bot)}:${chatId}`
  }

  private limiter(
    map: Map<number, ChatRateLimiter>,
    index: number,
    intervalMs: number,
  ): ChatRateLimiter {
    let limiter = map.get(index)
    if (limiter === undefined) {
      limiter = new ChatRateLimiter({
        perMinute: this.perMinute,
        intervalMs,
        now: this.now,
        sleep: this.sleep,
      })
      map.set(index, limiter)
    }
    return limiter
  }

  private sendLimiter(bot: BotHandle): ChatRateLimiter {
    return this.limiter(this.sendLimiters, this.indexOf(bot), this.intervalMs)
  }

  private editLimiter(bot: BotHandle): ChatRateLimiter {
    return this.limiter(this.editLimiters, this.indexOf(bot), this.editIntervalMs)
  }

  isBlocked(bot: BotHandle, chatId: number): boolean {
    return (this.blocked.get(this.key(bot, chatId)) ?? 0) > this.now()
  }

  isMissing(bot: BotHandle, chatId: number): boolean {
    return this.missing.has(this.key(bot, chatId))
  }

  markMissing(bot: BotHandle, chatId: number, missing: boolean): void {
    if (missing) this.missing.add(this.key(bot, chatId))
    else this.missing.delete(this.key(bot, chatId))
  }

  block(bot: BotHandle, chatId: number, ms = BLOCK_MS): void {
    this.blocked.set(this.key(bot, chatId), this.now() + ms)
  }

  unblock(bot: BotHandle, chatId: number): void {
    this.blocked.delete(this.key(bot, chatId))
  }

  /** A bot that could serve this chat at all (blocked ones still count, they just wait). */
  private eligible(bot: BotHandle, chatId: number): boolean {
    if (bot.disabled === true) return false
    // Private chats only exist with the main bot; publishers are group-only.
    if (chatId > 0 && !bot.main) return false
    return !this.isMissing(bot, chatId)
  }

  private usable(bot: BotHandle, chatId: number): boolean {
    return this.eligible(bot, chatId) && !this.isBlocked(bot, chatId)
  }

  /** First usable bot with a free send slot, in priority order. */
  pick(chatId: number): BotHandle | undefined {
    for (const bot of this.bots) {
      if (!this.usable(bot, chatId)) continue
      if (this.sendLimiter(bot).tryTake(chatId)) return bot
    }
    return undefined
  }

  /** Milliseconds until the earliest eligible bot can send; Infinity if none exist. */
  nextWait(chatId: number): number {
    let wait = Number.POSITIVE_INFINITY
    for (const bot of this.bots) {
      if (!this.eligible(bot, chatId)) continue
      const blockedUntil = this.blocked.get(this.key(bot, chatId)) ?? 0
      const blockWait = Math.max(0, blockedUntil - this.now())
      wait = Math.min(wait, Math.max(this.sendLimiter(bot).waitTime(chatId), blockWait))
    }
    return wait
  }

  /** Milliseconds until the main bot may send in this chat. */
  mainWait(chatId: number): number {
    return this.sendLimiter(this.main).waitTime(chatId)
  }

  /** Wait for the main bot's send slot, respecting a 429 block, for pinned messages. */
  async takeMain(chatId: number): Promise<void> {
    const blockedUntil = this.blocked.get(this.key(this.main, chatId)) ?? 0
    const wait = blockedUntil - this.now()
    if (wait > 0) await this.sleep(wait)
    await this.sendLimiter(this.main).take(chatId)
  }

  /** Reserve any usable bot, waiting for the earliest slot; undefined if none usable. */
  async reserve(chatId: number, maxWaitMs = 120_000): Promise<BotHandle | undefined> {
    const started = this.now()
    for (;;) {
      const bot = this.pick(chatId)
      if (bot !== undefined) return bot
      const wait = this.nextWait(chatId)
      if (!Number.isFinite(wait)) return undefined
      if (this.now() - started + wait > maxWaitMs) return undefined
      await this.sleep(Math.max(50, Math.min(wait, 1000)))
    }
  }

  /** Edits are their own budget, owned by the bot that sent the message. */
  async waitEdit(bot: BotHandle, chatId: number): Promise<void> {
    await this.editLimiter(bot).take(chatId)
  }

  editWait(bot: BotHandle, chatId: number): number {
    return this.editLimiter(bot).waitTime(chatId)
  }
}
