/**
 * Prompt text for replies that reference an earlier message.
 *
 * The connector sends the referenced media as attachment blocks; this module
 * only builds the text that tells the model what those blocks are and that they
 * are background context, not a separate request.
 *
 * @module dsh-telegram-connector/reference
 */

import {
  externalMediaDescriptor,
  mediaDescriptor,
  type MediaDescriptor,
} from './media.js'
import type { TgMessage } from './telegram.js'

export type ReferenceKind = 'same-chat' | 'external'

export interface ReplyReference {
  kind: ReferenceKind
  /** Original text/caption, or the quoted slice when the client sent one. */
  text: string
  /** Present for external replies when Telegram supplied the origin chat. */
  chatLabel?: string
  /** Present when the referenced message was itself forwarded. */
  forwardedFrom?: string
  media: MediaDescriptor[]
}

export interface ForwardedReference {
  text: string
  originLabel: string
  media: MediaDescriptor[]
}

type MessageOrigin = NonNullable<TgMessage['forward_origin']>

/** Human label for a forward origin, or undefined when the message is not forwarded. */
export function originLabel(origin: MessageOrigin | undefined): string | undefined {
  if (origin === undefined) return undefined
  switch (origin.type) {
    case 'user':
      return origin.sender_user?.username !== undefined
        ? `@${origin.sender_user.username}`
        : origin.sender_user?.first_name ?? 'a user'
    case 'hidden_user':
      return origin.sender_user_name ?? 'a hidden user'
    case 'chat':
      return origin.sender_chat?.title ?? 'a chat'
    case 'channel':
      return origin.chat?.title ?? 'a channel'
    default:
      return 'another chat'
  }
}

/** Forward label from either the modern origin or the legacy fields. */
export function forwardOriginLabel(message: TgMessage): string | undefined {
  return originLabel(message.forward_origin)
    ?? message.forward_from_chat?.title
    ?? (message.forward_from?.username !== undefined
      ? `@${message.forward_from.username}`
      : message.forward_from?.first_name)
    ?? message.forward_sender_name
}

const SKIP_RICH_KEYS = new Set(['type', 'url', 'href', 'align', 'valign', 'is_header', 'is_bordered', 'is_striped', 'is_compact', 'is_rtl'])

function collectRichText(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length > 0) out.push(trimmed)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectRichText(item, out)
    return
  }
  if (value === null || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  if (typeof record.text === 'string') {
    const trimmed = record.text.trim()
    if (trimmed.length > 0) out.push(trimmed)
    return
  }
  for (const [key, child] of Object.entries(record)) {
    if (SKIP_RICH_KEYS.has(key)) continue
    collectRichText(child, out)
  }
}

/** Flatten a rich message's blocks into a plain-text quote. */
export function richMessageText(rich: { blocks?: unknown[] } | undefined): string {
  if (rich?.blocks === undefined) return ''
  const parts: string[] = []
  collectRichText(rich.blocks, parts)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/** Extract the referenced message text/media from a same-chat or external reply. */
export function referenceOf(message: TgMessage): ReplyReference | undefined {
  const replied = message.reply_to_message
  if (replied !== undefined) {
    const media = mediaDescriptor(replied)
    const rich = richMessageText(replied.rich_message)
    const text = [replied.text, replied.caption, rich, message.quote?.text]
      .find((value) => value !== undefined && value.trim().length > 0) ?? ''
    if (text.trim().length === 0 && media === undefined) return undefined
    const forwardedFrom = forwardOriginLabel(replied)
    return {
      kind: 'same-chat',
      text,
      ...(forwardedFrom === undefined ? {} : { forwardedFrom }),
      media: media === undefined ? [] : [media],
    }
  }
  const external = message.external_reply
  if (external !== undefined) {
    const media = externalMediaDescriptor(external, message.chat.id)
    const text = message.quote?.text ?? ''
    if (text.trim().length === 0 && media === undefined) return undefined
    const forwardedFrom = originLabel(external.origin)
    return {
      kind: 'external',
      text,
      ...(external.chat?.title === undefined ? {} : { chatLabel: external.chat.title }),
      ...(forwardedFrom === undefined ? {} : { forwardedFrom }),
      media: media === undefined ? [] : [media],
    }
  }
  return undefined
}

/** Extract a message that was forwarded into the current chat. */
export function forwardedReference(message: TgMessage): ForwardedReference | undefined {
  const origin = forwardOriginLabel(message)
  if (origin === undefined) return undefined
  const text = [message.text, message.caption, richMessageText(message.rich_message)]
    .find((value) => value !== undefined && value.trim().length > 0) ?? ''
  const media = mediaDescriptor(message)
  if (text.trim().length === 0 && media === undefined) return undefined
  return { text, originLabel: origin, media: media === undefined ? [] : [media] }
}

const MAX_QUOTE = 800

function quote(text: string): string {
  const clean = text.trim()
  if (clean.length === 0) return '> (no text available)'
  const clipped = clean.length > MAX_QUOTE ? `${clean.slice(0, MAX_QUOTE - 1)}…` : clean
  return clipped.split('\n').map((line) => `> ${line}`).join('\n')
}

function mediaLine(media: readonly MediaDescriptor[], label = 'Referenced'): string[] {
  if (media.length === 0) return []
  return ['', `${label} media: ${media.map((item) => item.name).join(', ')} (attached)`]
}

function errorLines(errors: readonly string[], label = 'Referenced'): string[] {
  return errors.map((error) => `${label} media could not be downloaded: ${error}. The user may need to re-upload it, send it as a file, or grant the bot access to the source chat.`)
}

/** The reference block alone, used after the user's own text. */
export function formatReference(reference: ReplyReference, errors: readonly string[] = []): string {
  const header = reference.kind === 'external'
    ? '[Reference context — the user replied to a message from another chat/topic. This is background only, not a separate request. Use it as context for the user\'s message.]'
    : '[Reference context — the user replied to an earlier message. This is background only, not a separate request. Use it as context for the user\'s message. If the user has not asked a question or given an instruction, wait for the follow-up.]'
  const forwarded = reference.forwardedFrom === undefined ? '' : ` (forwarded from ${reference.forwardedFrom})`
  const origin = reference.kind === 'external'
    ? `Referenced message from ${reference.chatLabel ?? 'another chat/topic'}${forwarded}:`
    : `Referenced message${forwarded}:`
  return [
    header,
    '',
    origin,
    quote(reference.text),
    ...mediaLine(reference.media),
    ...errorLines(errors).map((line) => `\n${line}`),
  ].join('\n')
}

/** A forwarded message, used as its own context turn. */
export function formatForwardedReference(forward: ForwardedReference, errors: readonly string[] = []): string {
  return [
    '[Forwarded message — background context from another chat/session. It is not the user\'s own words.]',
    '',
    `Forwarded from: ${forward.originLabel}`,
    quote(forward.text),
    ...mediaLine(forward.media, 'Forwarded'),
    ...errorLines(errors, 'Forwarded').map((line) => `\n${line}`),
  ].join('\n')
}

/** A text reply: the user's text is the request; the reference is context. */
export function referencePrompt(
  userText: string,
  reference: ReplyReference,
  errors: readonly string[] = [],
): string {
  const text = userText.trim().length > 0 ? userText.trim() : 'The user referenced an earlier message.'
  return `${text}\n\n${formatReference(reference, errors)}`
}

/** A media reply: the new media is the task; the reference is background. */
export function mediaReplyPrompt(
  userText: string,
  reference: ReplyReference,
  errors: readonly string[] = [],
): string {
  const text = userText.trim().length > 0 ? userText.trim() : 'The user sent new media.'
  return [
    text,
    '',
    '[The new media is the task; the referenced message is background context.]',
    '',
    formatReference(reference, errors),
  ].join('\n')
}
