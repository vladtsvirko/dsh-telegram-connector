import { mkdtemp, mkdir, readdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BotPool, type BotHandle } from '../src/bots.js'
import { Outbox, type OutboxItem } from '../src/outbox.js'
import { TelegramApiError, type TelegramClient } from '../src/telegram.js'

interface Sent { chatId: number; text: string }

function client(handler: () => Promise<unknown> | void = () => undefined): { bot: BotHandle; sent: Sent[] } {
  const sent: Sent[] = []
  const fake = {
    sendMessage: async (chatId: number, text: string) => {
      sent.push({ chatId, text })
      await handler()
      return { message_id: sent.length }
    },
  } as unknown as TelegramClient
  return { bot: { label: 'main', main: true, client: fake }, sent }
}

function poolFor(bot: BotHandle): BotPool {
  return new BotPool([bot], { intervalMs: 0, perMinute: 1000, editIntervalMs: 0 })
}

let counter = 0
function item(chatId: number, text: string, priority: 'control' | 'normal' = 'normal'): OutboxItem {
  counter += 1
  return { id: `i${counter}`, chatId, threadId: 0, text, priority, createdAt: Date.now() + counter }
}

describe('Outbox', () => {
  it('sends FIFO and lets control jump the queue', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'outbox-'))
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { bot, sent } = client(async () => {
      if (sent.length === 1) await gate
    })
    const outbox = new Outbox({ dir, pool: poolFor(bot) })
    try {
      await outbox.enqueue(item(1, 'first'))
      await outbox.enqueue(item(1, 'second'))
      await outbox.enqueue(item(1, 'control', 'control'))
      release()
      await outbox.flush()
      expect(sent.map((entry) => entry.text)).toEqual(['first', 'control', 'second'])
      const files = await readdir(join(dir, '1'))
      expect(files.filter((file) => file.endsWith('.json'))).toHaveLength(0)
    } finally {
      await outbox.stop()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('recovers pending items and quarantines ambiguous sends', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'outbox-'))
    try {
      const chatDir = join(dir, '7')
      await mkdir(chatDir, { recursive: true })
      await writeFile(
        join(chatDir, 'pending-n-0000000000000001-a.json'),
        JSON.stringify({ id: 'a', chatId: 7, threadId: 0, text: 'kept', priority: 'normal', createdAt: 1 }),
      )
      await writeFile(
        join(chatDir, 'sending-n-0000000000000002-b.json'),
        JSON.stringify({ id: 'b', chatId: 7, threadId: 0, text: 'ambiguous', priority: 'normal', createdAt: 2 }),
      )
      const { bot, sent } = client()
      const lost: string[] = []
      const outbox = new Outbox({ dir, pool: poolFor(bot), onLost: (entry) => lost.push(entry.text) })
      await outbox.start()
      await outbox.flush()
      expect(sent.map((entry) => entry.text)).toEqual(['kept'])
      expect(lost).toEqual(['ambiguous'])
      await outbox.stop()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('retries a 429 and then delivers once', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'outbox-'))
    const attempts: string[] = []
    const bot: BotHandle = {
      label: 'main',
      main: true,
      client: {
        sendMessage: async (_chatId: number, text: string) => {
          attempts.push(text)
          if (attempts.length === 1) throw new TelegramApiError('sendMessage', 'Too Many Requests', 429, 0)
          return { message_id: 1 }
        },
      } as unknown as TelegramClient,
    }
    const pool = new BotPool([bot], { intervalMs: 0, perMinute: 1000 })
    const outbox = new Outbox({ dir, pool })
    try {
      await outbox.enqueue(item(3, 'hello'))
      await outbox.flush()
      expect(attempts).toEqual(['hello', 'hello'])
    } finally {
      await outbox.stop()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reports an acknowledged send', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'outbox-'))
    const { bot } = client()
    const outbox = new Outbox({ dir, pool: poolFor(bot) })
    try {
      const sent: string[] = []
      const item1 = item(5, 'tracked')
      item1.onSent = (id) => sent.push(id)
      await outbox.enqueue(item1)
      await outbox.flush()
      expect(sent).toEqual([item1.id])
    } finally {
      await outbox.stop()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('never retries an ambiguous transport failure', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'outbox-'))
    const { bot } = client(() => { throw new TypeError('fetch failed') })
    const lost: string[] = []
    const outbox = new Outbox({ dir, pool: poolFor(bot), onLost: (entry) => lost.push(entry.text) })
    try {
      await outbox.enqueue(item(4, 'lost once'))
      await outbox.flush()
      expect(lost).toEqual(['lost once'])
    } finally {
      await outbox.stop()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
