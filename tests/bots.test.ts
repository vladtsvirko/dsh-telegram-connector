import { describe, expect, it } from 'vitest'
import { BotPool, type BotHandle } from '../src/bots.js'
import type { TelegramClient } from '../src/telegram.js'

const handle = (label: string, main = false): BotHandle => ({ label, main, client: {} as TelegramClient })

function clock(start = 1_000_000) {
  let time = start
  return { now: () => time, advance: (ms: number) => { time += ms }, sleep: async (ms: number) => { time += ms } }
}

describe('BotPool', () => {
  it('picks bots in config order and switches when the first has no slot', () => {
    const time = clock()
    const pool = new BotPool([handle('main', true), handle('pub1'), handle('pub2')], {
      intervalMs: 1000, perMinute: 20, now: time.now, sleep: time.sleep,
    })
    const first = pool.pick(-1001)
    expect(first?.label).toBe('main')
    expect(pool.pick(-1001)?.label).toBe('pub1')
    expect(pool.pick(-1001)?.label).toBe('pub2')
    expect(pool.pick(-1001)).toBeUndefined()
    time.advance(1000)
    expect(pool.pick(-1001)?.label).toBe('main')
  })

  it('skips blocked and missing bots', async () => {
    const time = clock()
    const [main, pub] = [handle('main', true), handle('pub1')]
    const pool = new BotPool([main, pub], { intervalMs: 1000, now: time.now, sleep: time.sleep })
    pool.block(main, -1001, 5000)
    expect(pool.pick(-1001)?.label).toBe('pub1')
    pool.markMissing(pub, -1001, true)
    expect(pool.pick(-1001)).toBeUndefined()
    // the only eligible bot is blocked for 5s, so the wait is the block, not "no bot"
    expect(pool.nextWait(-1001)).toBe(5000)
    await expect(pool.reserve(-1001, 10)).resolves.toBeUndefined()
  })

  it('waits out a 429 block instead of dropping the chat', () => {
    const time = clock()
    const pool = new BotPool([handle('main', true)], { intervalMs: 1000, now: time.now, sleep: time.sleep })
    pool.block(pool.main, -1001, 5000)
    expect(pool.nextWait(-1001)).toBe(5000)
  })

  it('keeps chats independent', () => {
    const time = clock()
    const pool = new BotPool([handle('main', true)], { intervalMs: 1000, now: time.now, sleep: time.sleep })
    expect(pool.pick(-1001)?.label).toBe('main')
    expect(pool.pick(-1002)?.label).toBe('main')
    expect(pool.pick(-1001)).toBeUndefined()
  })

  it('keeps edit pacing separate from sends', () => {
    const time = clock()
    const main = handle('main', true)
    const pool = new BotPool([main], { intervalMs: 1000, editIntervalMs: 500, now: time.now, sleep: time.sleep })
    expect(pool.pick(-1001)).toBeDefined()
    expect(pool.editWait(main, -1001)).toBe(0)
    return pool.waitEdit(main, -1001).then(() => {
      expect(pool.editWait(main, -1001)).toBe(500)
    })
  })
})
