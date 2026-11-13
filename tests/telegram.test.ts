import { afterEach, describe, expect, it, vi } from 'vitest'
import { TelegramApiError, TelegramClient, isRichRejected } from '../src/telegram.js'

const calls: { url: string; body: Record<string, unknown> }[] = []

function stubTelegram(result: unknown): void {
  vi.stubGlobal('fetch', async (url: string, init: { body?: string }) => {
    calls.push({ url, body: JSON.parse(init.body ?? '{}') as Record<string, unknown> })
    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
}

afterEach(() => {
  calls.length = 0
  vi.unstubAllGlobals()
})

describe('telegram client', () => {
  it('subscribes to button presses, messages and widget requests', async () => {
    stubTelegram([])
    await new TelegramClient('tok').getUpdates(7, 25)
    expect(calls[0]?.body.allowed_updates).toEqual(['message', 'callback_query', 'widget_query'])
    expect(calls[0]?.body.offset).toBe(7)
  })

  it('sends a widget with a caption and query permission', async () => {
    stubTelegram({ message_id: 5 })
    await new TelegramClient('tok').sendWidget(11, '<b>hi</b>', { caption: 'panel', allowQueries: true })
    expect(calls[0]?.url).toContain('/bottok/sendWidget')
    expect(calls[0]?.body).toEqual({
      chat_id: 11,
      html: '<b>hi</b>',
      caption: 'panel',
      allow_queries: true,
    })
  })

  it('answers a widget query without changing the widget', async () => {
    stubTelegram(true)
    await new TelegramClient('tok').answerWidgetQuery('wq1', '{"t":"s"}')
    expect(calls[0]?.url).toContain('/bottok/answerWidgetQuery')
    expect(calls[0]?.body).toEqual({ widget_query_id: 'wq1', data: '{"t":"s"}' })
  })

  it('answers a callback query with an optional toast', async () => {
    stubTelegram(true)
    await new TelegramClient('tok').answerCallbackQuery('q1', 'committing…')
    expect(calls[0]?.url).toContain('/bottok/answerCallbackQuery')
    expect(calls[0]?.body).toEqual({ callback_query_id: 'q1', text: 'committing…' })
  })

  it('attaches an inline keyboard and removes it on edit', async () => {
    stubTelegram({ message_id: 1 })
    const client = new TelegramClient('tok')
    const markup = { inline_keyboard: [[{ text: 'Commit', callback_data: 'trial:commit:x' }]] }
    await client.sendMessage(42, 'trial', { replyMarkup: markup })
    await client.editMessageText(42, 9, 'done', { replyMarkup: { inline_keyboard: [] } })
    expect(calls[0]?.body.reply_markup).toEqual(markup)
    expect(calls[1]?.body.reply_markup).toEqual({ inline_keyboard: [] })
    expect(calls[1]?.body.message_id).toBe(9)
  })

  it('sends and edits rich messages through the rich_message field', async () => {
    stubTelegram({ message_id: 5 })
    const client = new TelegramClient('tok')
    await client.sendRichMessage(-100, '| A | B |\n|---|---|\n| 1 | 2 |', { threadId: 7 })
    await client.editRichMessageText(-100, 5, '| A | B |\n|---|---|\n| 1 | 3 |')
    expect(calls[0]?.url).toContain('/sendRichMessage')
    expect(calls[0]?.body.rich_message).toEqual({ markdown: '| A | B |\n|---|---|\n| 1 | 2 |' })
    expect(calls[0]?.body.message_thread_id).toBe(7)
    expect(calls[0]?.body.parse_mode).toBeUndefined()
    expect(calls[1]?.url).toContain('/editMessageText')
    expect(calls[1]?.body.rich_message).toEqual({ markdown: '| A | B |\n|---|---|\n| 1 | 3 |' })
    expect(calls[1]?.body.text).toBeUndefined()
  })

  it('sets and clears a reaction', async () => {
    stubTelegram(true)
    const client = new TelegramClient('tok')
    await client.setMessageReaction(-100, 8, ['👀'])
    await client.setMessageReaction(-100, 8, [])
    expect(calls[0]?.url).toContain('/setMessageReaction')
    expect(calls[0]?.body).toEqual({
      chat_id: -100,
      message_id: 8,
      reaction: [{ type: 'emoji', emoji: '👀' }],
      is_big: false,
    })
    expect(calls[1]?.body.reaction).toEqual([])
  })

  it('resolves and downloads a Telegram file by id', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url)
      if (url.includes('/getFile')) {
        return new Response(JSON.stringify({
          ok: true,
          result: { file_id: 'f1', file_unique_id: 'u1', file_path: 'photos/file.jpg' },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    })
    const data = await new TelegramClient('tok').downloadFile('f1')
    expect(Array.from(data)).toEqual([1, 2, 3])
    expect(urls[0]).toContain('/bottok/getFile')
    expect(urls[1]).toContain('/file/bottok/photos/file.jpg')
  })
})

describe('isRichRejected', () => {
  it('classifies unsupported or malformed rich content as a fallback case', () => {
    expect(isRichRejected(new TelegramApiError('sendRichMessage', 'Not Found', 404))).toBe(true)
    expect(isRichRejected(new TelegramApiError('sendRichMessage', "can't parse entities", 400))).toBe(true)
    expect(isRichRejected(new TelegramApiError('sendRichMessage', 'message is too long', 400))).toBe(true)
  })

  it('does not hide rate limits, membership failures or transport errors', () => {
    expect(isRichRejected(new TelegramApiError('sendRichMessage', 'Too Many Requests', 429, 3))).toBe(false)
    expect(isRichRejected(new TelegramApiError('sendRichMessage', 'chat not found', 400))).toBe(false)
    expect(isRichRejected(new TypeError('fetch failed'))).toBe(false)
  })
})

describe('timeouts', () => {
  const capture = (reply) => {
    const signals = []
    vi.stubGlobal('fetch', async (url, init) => {
      signals.push(init.signal)
      return reply(url)
    })
    return signals
  }

  it('attaches a deadline to an ordinary call', async () => {
    const signals = capture(() => new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }))
    await new TelegramClient('tok', { requestTimeoutMs: 1234 }).sendMessage(1, 'hi')
    expect(signals).toHaveLength(1)
    expect(signals[0]).toBeInstanceOf(AbortSignal)
  })

  it('gives a download its own, longer deadline', async () => {
    const signals = capture((url) => (url.includes('/file/')
      ? new Response(new Uint8Array([1, 2, 3]))
      : new Response(JSON.stringify({ ok: true, result: { file_id: 'f', file_path: 'photos/x.jpg' } }), { status: 200 })))
    const data = await new TelegramClient('tok', { downloadTimeoutMs: 5000 }).downloadFile('f')
    expect(data.byteLength).toBe(3)
    expect(signals).toHaveLength(2)
    expect(signals[1]).toBeInstanceOf(AbortSignal)
  })

  it('fails instead of hanging when the call never answers', async () => {
    vi.stubGlobal('fetch', (_url, init) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    const client = new TelegramClient('tok', { requestTimeoutMs: 20 })
    await expect(client.sendMessage(1, 'hi')).rejects.toThrow()
  })
})
