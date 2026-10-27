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

export interface TgMessage {
  message_id: number
  chat: TgChat
  from?: TgUser
  text?: string
  /** Present on every message inside a forum topic. */
  is_topic_message?: boolean
  message_thread_id?: number
  /** Present on the service message Telegram sends when a topic is created. */
  forum_topic_created?: { name: string }
  /** On the first message of a topic this carries `forum_topic_created`. */
  reply_to_message?: TgMessage
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
