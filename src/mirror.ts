/**
 * Helpers for mirroring a session driven elsewhere (the web UI) into its
 * Telegram topic.
 *
 * DSH records harness-injected context as ordinary `user/message` events: the
 * time-context plugin, for one, prepends a three-line reading before every
 * eligible model step. Those are model input, not something the user typed, so
 * the mirror must tell them apart by `source.kind` and never post them as a
 * prompt.
 *
 * Mirrored events are produced in log order, but the sends themselves are
 * asynchronous. A per-topic queue keeps the prompt ahead of its answer even
 * when a long prompt needs several outbox writes or Telegram is rate-limiting.
 *
 * @module dsh-telegram-connector/mirror
 */

export interface MirrorBlock {
  readonly type: string
  readonly text?: string
}

export interface MirrorMessage {
  readonly content?: readonly MirrorBlock[]
  readonly source?: { readonly kind?: string }
}

/** Text blocks of a message, in order; non-text blocks (reasoning, tools) are ignored. */
export function messageText(message: MirrorMessage | undefined): string {
  return (message?.content ?? [])
    .map((block) => (block.type === 'text' ? (block.text ?? '') : ''))
    .filter((part) => part.length > 0)
    .join('\n')
}

/**
 * Whether a stored message is harness plumbing rather than a conversational
 * turn. Used when replaying a session read from disk, where `source.kind` is
 * still available but older records may predate the current producers.
 */
export function isInjectedContext(text: string): boolean {
  const head = text.slice(0, 200)
  return (
    /Current runtime context/i.test(head) ||
    /runtime-context snapshot/i.test(head) ||
    /^Time sampled while preparing/i.test(head) ||
    /Browser time zone for this request/i.test(head) ||
    /Elapsed since the preceding model-visible message/i.test(head) ||
    /preparing turn \d+, step \d+/i.test(head)
  )
}

/**
 * The text to mirror for a `user/message`, or `undefined` when it is injected
 * context. Only source kind `user` is a prompt typed by a human; everything
 * else (time context, skill content, file-change notices, goal continuations)
 * is model input.
 */
export function promptText(message: MirrorMessage | undefined): string | undefined {
  if (message?.source?.kind !== 'user') return undefined
  const text = messageText(message)
  return text.length === 0 || isInjectedContext(text) ? undefined : text
}

/**
 * Serialises tasks per key. Enqueue is synchronous, so the call order is the
 * order in which tasks are appended, regardless of how long an earlier task
 * takes.
 */
export class MirrorQueue {
  private readonly tails = new Map<string, Promise<void>>()

  constructor(private readonly onError: (error: unknown) => void = () => undefined) {}

  enqueue(key: string, task: () => Promise<void>): Promise<void> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    const next = previous
      .then(task)
      .catch((error: unknown) => {
        this.onError(error)
      })
    this.tails.set(key, next)
    void next.then(() => {
      if (this.tails.get(key) === next) this.tails.delete(key)
    })
    return next
  }

  /** Number of keys with work queued or running; tests use it to wait for idle. */
  get size(): number {
    return this.tails.size
  }
}
