import { afterEach, describe, expect, it, vi } from 'vitest'
import { TelegramClient } from '../src/telegram.js'

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
  it('subscribes to button presses as well as messages', async () => {
    stubTelegram([])
    await new TelegramClient('tok').getUpdates(7, 25)
    expect(calls[0]?.body.allowed_updates).toEqual(['message', 'callback_query'])
    expect(calls[0]?.body.offset).toBe(7)
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
})
