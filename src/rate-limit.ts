/**
 * Per-chat pacing for Telegram.
 *
 * A group tolerates roughly one message per second and about twenty per minute.
 * `/sync` can create topics, probe topics and replay history, so it must pace
 * itself instead of discovering the limit through 429s.
 *
 * @module dsh-telegram-connector/rate-limit
 */

export interface RateLimiterOptions {
  /** Messages allowed in a sliding minute; Telegram's group limit is 20. */
  perMinute?: number
  /** Minimum spacing between messages in one chat. */
  intervalMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const WINDOW_MS = 60_000

export class ChatRateLimiter {
  private readonly perMinute: number
  private readonly intervalMs: number
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly chats = new Map<number, { sent: number[]; last: number }>()

  constructor(options: RateLimiterOptions = {}) {
    this.perMinute = options.perMinute ?? 20
    this.intervalMs = options.intervalMs ?? 1100
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  /**
   * Wait until this chat may receive another message, then record it.
   * Returns how long the call had to wait, so the caller can tell the user
   * when the pause is long enough to explain.
   */
  async take(chatId: number): Promise<number> {
    let waited = 0
    for (;;) {
      const wait = this.waitTime(chatId)
      if (wait <= 0) {
        this.record(chatId)
        return waited
      }
      await this.sleep(wait)
      waited += wait
    }
  }

  /** Take a slot without waiting; false means the caller must wait or pick another bot. */
  tryTake(chatId: number): boolean {
    if (this.waitTime(chatId) > 0) return false
    this.record(chatId)
    return true
  }

  /** Milliseconds until this chat may send again (0 = now). */
  waitTime(chatId: number): number {
    const now = this.now()
    const entry = this.chats.get(chatId) ?? { sent: [], last: 0 }
    entry.sent = entry.sent.filter((at) => at > now - WINDOW_MS)
    const intervalWait = Math.max(0, entry.last + this.intervalMs - now)
    const oldest = entry.sent[0]
    const budgetWait = entry.sent.length >= this.perMinute && oldest !== undefined
      ? Math.max(0, oldest + WINDOW_MS - now)
      : 0
    return Math.max(intervalWait, budgetWait)
  }

  private record(chatId: number): void {
    const now = this.now()
    const entry = this.chats.get(chatId) ?? { sent: [], last: 0 }
    entry.sent.push(now)
    entry.last = now
    this.chats.set(chatId, entry)
  }
}
