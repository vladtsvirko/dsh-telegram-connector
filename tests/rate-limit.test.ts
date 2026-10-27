import { describe, expect, it } from 'vitest'
import { ChatRateLimiter } from '../src/rate-limit.js'

function clock(start = 1_000_000) {
  let time = start
  return {
    now: () => time,
    advance: (ms: number) => { time += ms },
    sleep: async (ms: number) => { time += ms },
  }
}

describe('ChatRateLimiter', () => {
  it('spaces messages by the per-chat interval', async () => {
    const time = clock()
    const limiter = new ChatRateLimiter({ intervalMs: 1000, perMinute: 20, now: time.now, sleep: time.sleep })
    expect(await limiter.take(1)).toBe(0)
    time.advance(200)
    expect(await limiter.take(1)).toBe(800)
    expect(await limiter.take(1)).toBe(1000)
  })

  it('keeps chats independent', async () => {
    const time = clock()
    const limiter = new ChatRateLimiter({ intervalMs: 1000, perMinute: 20, now: time.now, sleep: time.sleep })
    await limiter.take(1)
    expect(await limiter.take(2)).toBe(0)
  })

  it('enforces the sliding per-minute budget', async () => {
    const time = clock()
    const limiter = new ChatRateLimiter({ intervalMs: 1, perMinute: 3, now: time.now, sleep: time.sleep })
    await limiter.take(7)
    await limiter.take(7)
    await limiter.take(7)
    time.advance(1000)
    // The fourth message must wait until the first one leaves the window.
    expect(await limiter.take(7)).toBe(58_998)
  })

  it('offers a non-blocking take and a wait estimate', async () => {
    const time = clock()
    const limiter = new ChatRateLimiter({ intervalMs: 1000, perMinute: 20, now: time.now, sleep: time.sleep })
    expect(limiter.tryTake(3)).toBe(true)
    expect(limiter.tryTake(3)).toBe(false)
    expect(limiter.waitTime(3)).toBe(1000)
    time.advance(1000)
    expect(limiter.waitTime(3)).toBe(0)
    expect(limiter.tryTake(3)).toBe(true)
  })

  it('recounts after the window passes', async () => {
    const time = clock()
    const limiter = new ChatRateLimiter({ intervalMs: 1, perMinute: 2, now: time.now, sleep: time.sleep })
    await limiter.take(9)
    await limiter.take(9)
    time.advance(61_000)
    expect(await limiter.take(9)).toBe(0)
  })
})
