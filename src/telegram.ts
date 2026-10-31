/**
 * Thin, dependency-free Telegram Bot API client.
 *
 * Only the handful of methods a chat connector needs are wrapped, but they are
 * typed and thread-aware: `message_thread_id` is a first-class argument, because
 * a forum topic is the unit this connector works in.
 */

export const TG_API = 'https://api.telegram.org'

export interface TgUser {
  id: number
  is_bot?: boolean
  first_name?: string
  username?: string
}

export interface TgChat {
  id: number
  type: 'private' | 'group' | 'supergroup' | 'channel'
  title?: string
  is_forum?: boolean
}

export interface TgPhotoSize {
  file_id: string
  file_unique_id: string
  width: number
  height: number
  file_size?: number
}

export interface TgDocument {
  file_id: string
  file_unique_id: string
  file_name?: string
  mime_type?: string
  file_size?: number
}

export interface TgVideo {
  file_id: string
  file_unique_id: string
  file_name?: string
  mime_type?: string
  file_size?: number
  width: number
  height: number
  duration: number
}

export interface TgVideoNote {
  file_id: string
  file_unique_id: string
  file_size?: number
  length: number
  duration: number
}

export interface TgAudio {
  file_id: string
  file_unique_id: string
  file_name?: string
  mime_type?: string
  file_size?: number
  duration: number
  performer?: string
  title?: string
}

export interface TgVoice {
  file_id: string
  file_unique_id: string
  mime_type?: string
  file_size?: number
  duration: number
}

export interface TgAnimation {
  file_id: string
  file_unique_id: string
  file_name?: string
  mime_type?: string
  file_size?: number
  width: number
  height: number
  duration: number
}

export interface TgSticker {
  file_id: string
  file_unique_id: string
  file_size?: number
  mime_type?: string
  is_animated?: boolean
  is_video?: boolean
  emoji?: string
}

export interface TgFile {
  file_id: string
  file_unique_id: string
  file_size?: number
  file_path?: string
}

/** The media subset of ExternalReplyInfo used when the user replies across chats/topics. */
export interface TgExternalReplyInfo {
  origin?: TgMessageOrigin
  chat?: TgChat
  message_id?: number
  photo?: TgPhotoSize[]
  document?: TgDocument
  video?: TgVideo
  video_note?: TgVideoNote
  audio?: TgAudio
  voice?: TgVoice
  animation?: TgAnimation
  sticker?: TgSticker
}

export interface TgTextQuote {
  text: string
}

/** The subset of MessageOrigin used to label forwarded content. */
export interface TgMessageOrigin {
  type: string
  date?: number
  sender_user?: TgUser
  sender_user_name?: string
  sender_chat?: TgChat
  chat?: TgChat
  message_id?: number
}

export interface TgMessage {
  message_id: number
  chat: TgChat
  from?: TgUser
  text?: string
  /** Present instead of `text` for messages sent with sendRichMessage. */
  rich_message?: { blocks?: unknown[] }
  /** Modern forward metadata; a forwarded rich message has this and no `text`. */
  forward_origin?: TgMessageOrigin
  /** Legacy forward metadata kept for older updates. */
  forward_from?: TgUser
  forward_from_chat?: TgChat
  forward_from_message_id?: number
  forward_sender_name?: string
  /** Caption on a photo/document/video/audio/animation message. */
  caption?: string
  /** Album identifier shared by the several updates of one media group. */
  media_group_id?: string
  photo?: TgPhotoSize[]
  document?: TgDocument
  video?: TgVideo
  video_note?: TgVideoNote
  audio?: TgAudio
  voice?: TgVoice
  animation?: TgAnimation
  sticker?: TgSticker
  /** The original message when this one is a same-chat reply. */
  reply_to_message?: TgMessage
  /** The original message when this one replies across chats/topics. */
  external_reply?: TgExternalReplyInfo
  /** Quoted slice of the replied-to message, when the client sends one. */
  quote?: TgTextQuote
  /** Present on every message inside a forum topic. */
  is_topic_message?: boolean
  message_thread_id?: number
  /** Present on the service message Telegram sends when a topic is created. */
  forum_topic_created?: { name: string }
  /** Service message Telegram sends when a topic is renamed. */
  forum_topic_edited?: { name?: string }
  /** Service message Telegram sends when the group itself is renamed. */
  new_chat_title?: string
  /** Service message when a topic is closed (archived-looking) or reopened. */
  forum_topic_closed?: Record<string, never>
  forum_topic_reopened?: Record<string, never>
}

export interface TgForumTopic {
  message_thread_id: number
  name: string
  icon_color?: number
}

export interface TgCallbackQuery {
  id: string
  from?: TgUser
  /** The message the button lives on; absent for inline-mode callbacks. */
  message?: TgMessage
  data?: string
  chat_instance?: string
}

export interface TgUpdate {
  update_id: number
  message?: TgMessage
  callback_query?: TgCallbackQuery
}

export interface TgInlineButton {
  text: string
  callback_data: string
}

export interface TgChatMember {
  status: 'creator' | 'administrator' | 'member' | 'restricted' | 'left' | 'kicked'
  user?: TgUser
}

export interface TgInlineKeyboard {
  inline_keyboard: TgInlineButton[][]
}

/** Telegram accepts a fixed emoji set for reactions; see reactions.ts. */
export interface TgReaction {
  type: 'emoji'
  emoji: string
}

interface TgEnvelope<T> {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
  parameters?: { retry_after?: number }
}

/** A Bot API call that returned `ok: false`. */
export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly description: string,
    readonly errorCode?: number,
    readonly retryAfter?: number,
  ) {
    super(`telegram ${method}: ${description}`)
    this.name = 'TelegramApiError'
  }
}

export interface SendOptions {
  /** Forum topic to post into; omitted for private chats and the General topic. */
  threadId?: number
  parseMode?: 'HTML' | 'MarkdownV2'
  /** Disable link previews: agent output is usually prose, not shareable links. */
  disablePreview?: boolean
  /** Buttons under the message; an empty keyboard removes them on edit. */
  replyMarkup?: TgInlineKeyboard
}

/** Rich messages have no parse mode and no link-preview switch. */
export interface RichSendOptions {
  threadId?: number
  replyMarkup?: TgInlineKeyboard
}

/**
 * True when Telegram rejected a rich message because the API or the content
 * does not support it. Callers then fall back to the plain HTML subset; a 429,
 * 5xx or transport failure must be retried instead.
 */
export function isRichRejected(error: unknown): boolean {
  if (!(error instanceof TelegramApiError)) return false
  if (error.errorCode === 404 || error.errorCode === 405 || error.errorCode === 501) return true
  if (error.errorCode !== 400) return false
  const description = error.description.toLowerCase()
  return description.includes('rich')
    || description.includes('parse')
    || description.includes('entity')
    || description.includes('too long')
    || description.includes('unsupported')
    || description.includes('unknown method')
}

export class TelegramClient {
  constructor(private readonly token: string) {}

  async call<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch(`${TG_API}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const envelope = (await response.json()) as TgEnvelope<T>
    if (!envelope.ok) {
      throw new TelegramApiError(method, envelope.description ?? 'unknown error', envelope.error_code, envelope.parameters?.retry_after)
    }
    return envelope.result as T
  }

  getMe(): Promise<TgUser> {
    return this.call<TgUser>('getMe')
  }

  /** Resolve a Telegram file id to a temporary download path. */
  getFile(fileId: string): Promise<TgFile> {
    return this.call<TgFile>('getFile', { file_id: fileId })
  }

  /**
   * Download a file sent to the bot. The Bot API caps this at 20 MB; callers
   * should check `file_size` first and report larger files instead of failing
   * after the round trip. The token is part of the URL and must never be logged.
   */
  async downloadFile(fileId: string): Promise<Uint8Array> {
    const file = await this.getFile(fileId)
    if (file.file_path === undefined || file.file_path.length === 0) {
      throw new Error('Telegram returned no file_path for this file')
    }
    const response = await fetch(`${TG_API}/file/bot${this.token}/${file.file_path}`)
    if (!response.ok) {
      throw new Error(`Telegram file download failed (${String(response.status)})`)
    }
    return new Uint8Array(await response.arrayBuffer())
  }

  getUpdates(offset: number, timeoutSeconds: number): Promise<TgUpdate[]> {
    return this.call<TgUpdate[]>('getUpdates', {
      offset,
      timeout: timeoutSeconds,
      // Without this Telegram may hold other update kinds in the same queue and
      // the offset would advance past messages we never saw. Button presses are
      // updates too, so they have to be named explicitly.
      allowed_updates: ['message', 'callback_query'],
    })
  }

  sendMessage(chatId: number, text: string, options: SendOptions = {}): Promise<TgMessage> {
    return this.call<TgMessage>('sendMessage', {
      chat_id: chatId,
      text,
      ...(options.threadId === undefined ? {} : { message_thread_id: options.threadId }),
      ...(options.parseMode === undefined ? {} : { parse_mode: options.parseMode }),
      ...(options.disablePreview === false ? {} : { link_preview_options: { is_disabled: true } }),
      ...(options.replyMarkup === undefined ? {} : { reply_markup: options.replyMarkup }),
    })
  }

  editMessageText(chatId: number, messageId: number, text: string, options: SendOptions = {}): Promise<TgMessage | boolean> {
    return this.call<TgMessage | boolean>('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      ...(options.parseMode === undefined ? {} : { parse_mode: options.parseMode }),
      ...(options.disablePreview === false ? {} : { link_preview_options: { is_disabled: true } }),
      ...(options.replyMarkup === undefined ? {} : { reply_markup: options.replyMarkup }),
    })
  }

  /**
   * Send a rich message (Bot API 10.1+). Markdown is passed through to
   * Telegram's own parser, which renders headings, lists and tables natively.
   * Callers must fall back to `sendMessage` when `isRichRejected` says so.
   */
  sendRichMessage(chatId: number, markdown: string, options: RichSendOptions = {}): Promise<TgMessage> {
    return this.call<TgMessage>('sendRichMessage', {
      chat_id: chatId,
      rich_message: { markdown },
      ...(options.threadId === undefined ? {} : { message_thread_id: options.threadId }),
      ...(options.replyMarkup === undefined ? {} : { reply_markup: options.replyMarkup }),
    })
  }

  /** Edit a rich message in place; the counterpart of `sendRichMessage`. */
  editRichMessageText(
    chatId: number,
    messageId: number,
    markdown: string,
    options: RichSendOptions = {},
  ): Promise<TgMessage | boolean> {
    return this.call<TgMessage | boolean>('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      rich_message: { markdown },
      ...(options.replyMarkup === undefined ? {} : { reply_markup: options.replyMarkup }),
    })
  }

  /**
   * Set or clear a reaction on a message. Bots may use one reaction per message
   * and only Telegram's fixed emoji set; an empty list removes the bot's own
   * reaction. Failures are cosmetic and left to the caller to ignore.
   */
  setMessageReaction(
    chatId: number,
    messageId: number,
    emojis: readonly string[],
    isBig = false,
  ): Promise<boolean> {
    return this.call<boolean>('setMessageReaction', {
      chat_id: chatId,
      message_id: messageId,
      reaction: emojis.map((emoji): TgReaction => ({ type: 'emoji', emoji })),
      is_big: isBig,
    })
  }

  /** Acknowledge a button press; Telegram shows the text as a toast. */
  answerCallbackQuery(id: string, text?: string): Promise<boolean> {
    return this.call<boolean>('answerCallbackQuery', {
      callback_query_id: id,
      ...(text === undefined ? {} : { text }),
    })
  }

  /** Membership check; the calling bot needs admin rights in the chat to ask. */
  getChatMember(chatId: number, userId: number): Promise<TgChatMember> {
    return this.call<TgChatMember>('getChatMember', { chat_id: chatId, user_id: userId })
  }

  createForumTopic(chatId: number, name: string): Promise<TgForumTopic> {
    return this.call<TgForumTopic>('createForumTopic', { chat_id: chatId, name })
  }

  editForumTopic(chatId: number, threadId: number, name: string): Promise<boolean> {
    return this.call<boolean>('editForumTopic', { chat_id: chatId, message_thread_id: threadId, name })
  }

  deleteForumTopic(chatId: number, threadId: number): Promise<boolean> {
    return this.call<boolean>('deleteForumTopic', { chat_id: chatId, message_thread_id: threadId })
  }

  closeForumTopic(chatId: number, threadId: number): Promise<boolean> {
    return this.call<boolean>('closeForumTopic', { chat_id: chatId, message_thread_id: threadId })
  }

  reopenForumTopic(chatId: number, threadId: number): Promise<boolean> {
    return this.call<boolean>('reopenForumTopic', { chat_id: chatId, message_thread_id: threadId })
  }

  /** Group title follows the workspace title; needs admin with can_change_info. */
  setChatTitle(chatId: number, title: string): Promise<boolean> {
    return this.call<boolean>('setChatTitle', { chat_id: chatId, title: title.slice(0, 128) })
  }

  /** Best-effort typing indicator; failures are not worth surfacing. */
  async setTyping(chatId: number, threadId?: number): Promise<void> {
    try {
      await this.call('sendChatAction', {
        chat_id: chatId,
        action: 'typing',
        ...(threadId === undefined ? {} : { message_thread_id: threadId }),
      })
    } catch {
      /* cosmetic */
    }
  }
}
