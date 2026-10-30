/**
 * Reaction settings.
 *
 * Telegram only accepts a fixed set of emoji reactions (Bot API
 * `ReactionTypeEmoji`), so a user-supplied symbol is validated against that set
 * before it is stored. A check mark such as "✓" or "✅" is not in the set; the
 * defaults below use "👀" for "read" and "✍" for "still writing".
 *
 * Settings are resolved from the durable bindings first and the plugin config
 * second, so `/reactions` can change them online without a restart.
 *
 * @module dsh-telegram-connector/reactions
 */

/** The emoji Telegram accepts in a reaction. Keep in sync with ReactionTypeEmoji. */
export const ALLOWED_REACTIONS = [
  '❤', '👍', '👎', '🔥', '🥰', '👏', '😁', '🤔', '🤯', '😱', '🤬', '😢',
  '🎉', '🤩', '🤮', '💩', '🙏', '👌', '🕊', '🤡', '🥱', '🥴', '😍', '🐳',
  '❤‍🔥', '🌚', '🌭', '💯', '🤣', '⚡', '🍌', '🏆', '💔', '🤨', '😐', '🍓',
  '🍾', '💋', '🖕', '😈', '😴', '😭', '🤓', '👻', '👨‍💻', '👀', '🎃', '🙈',
  '😇', '😨', '🤝', '✍', '🤗', '🫡', '🎅', '🎄', '☃', '💅', '🤪', '🗿',
  '🆒', '💘', '🙉', '🦄', '😘', '💊', '🙊', '😎', '👾', '🤷‍♂', '🤷', '🤷‍♀', '😡',
] as const

export type ReactionEmoji = typeof ALLOWED_REACTIONS[number]

export interface ReactionSettings {
  /** Master switch for both reactions. */
  enabled: boolean
  /** Set on the user's prompt once the connector has read it; empty disables it. */
  read: string
  /** Set on a streamed bot message while it may still be edited; empty disables it. */
  streaming: string
  /** Set on media staged until a caption or text prompt arrives; empty disables it. */
  staged: string
}

export const DEFAULT_REACTIONS: ReactionSettings = {
  enabled: true,
  read: '👀',
  streaming: '✍',
  staged: '🙉',
}

/** Stored overrides; an empty string means "do not react" for that slot. */
export interface StoredReactions {
  enabled?: boolean
  read?: string
  streaming?: string
  staged?: string
}

const VARIATION_SELECTOR = /\uFE0F/g

function withoutVariationSelector(value: string): string {
  return value.replace(VARIATION_SELECTOR, '')
}

/**
 * Canonical allowed emoji for a user-supplied value.
 *
 * Telegram clients often append U+FE0F to emoji such as "✍", so the comparison
 * ignores it. Returns undefined when the value is not an allowed reaction.
 */
export function canonicalReaction(value: string): string | undefined {
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  const normalized = withoutVariationSelector(trimmed)
  return ALLOWED_REACTIONS.find((emoji) => emoji === trimmed || withoutVariationSelector(emoji) === normalized)
}

export function isReactionEmoji(value: string): boolean {
  return canonicalReaction(value) !== undefined
}

/**
 * Parse a `/reactions <slot> <value>` argument.
 *
 * `off`, `none` and `-` are accepted as an explicit "no reaction"; otherwise the
 * emoji must be in Telegram's allowed set.
 */
export function parseReactionValue(input: string): { value: string } | { error: string } {
  const trimmed = input.trim()
  if (trimmed.length === 0) return { error: 'missing reaction emoji' }
  if (/^(?:off|none|-)$/i.test(trimmed)) return { value: '' }
  const emoji = canonicalReaction(trimmed)
  if (emoji === undefined) {
    return {
      error: `\`${trimmed}\` is not a Telegram reaction. Allowed examples: 👀 ✍ 👍 🎉 🤝 ⚡ — see \`/reactions allowed\`.`,
    }
  }
  return { value: emoji }
}

function pick(
  stored: string | undefined,
  configured: string | undefined,
  fallback: string,
): string {
  for (const candidate of [stored, configured]) {
    if (candidate === undefined) continue
    if (candidate.trim().length === 0) return ''
    const emoji = canonicalReaction(candidate)
    if (emoji !== undefined) return emoji
  }
  return fallback
}

/** Durable bindings win over the plugin row; unusable values fall through. */
export function resolveReactions(
  stored: StoredReactions | undefined,
  configured: Partial<ReactionSettings> | undefined,
): ReactionSettings {
  return {
    enabled: stored?.enabled ?? configured?.enabled ?? DEFAULT_REACTIONS.enabled,
    read: pick(stored?.read, configured?.read, DEFAULT_REACTIONS.read),
    streaming: pick(stored?.streaming, configured?.streaming, DEFAULT_REACTIONS.streaming),
    staged: pick(stored?.staged, configured?.staged, DEFAULT_REACTIONS.staged),
  }
}

function show(emoji: string): string {
  return emoji.length === 0 ? '_off_' : emoji
}

/** Text for `/reactions` with no argument. */
export function describeReactions(settings: ReactionSettings): string {
  return [
    `reactions: ${settings.enabled ? 'on' : 'off'}`,
    `read: ${show(settings.read)} — set on your prompt when the bot reads it`,
    `streaming: ${show(settings.streaming)} — set on a reply while it is still being edited`,
    `staged: ${show(settings.staged)} — set on media waiting for a caption or prompt`,
    '',
    'change: `/reactions read 👀` · `/reactions streaming ✍` · `/reactions staged 🙉` · `/reactions off|on` · `/reactions reset`',
    'Telegram only accepts its own reaction emoji; `/reactions allowed` lists them.',
  ].join('\n')
}

/** A compact list for `/reactions allowed`. */
export function allowedReactionsText(): string {
  return `**Telegram reaction emoji**\n${ALLOWED_REACTIONS.join(' ')}`
}
