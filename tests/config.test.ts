import { describe, expect, it } from 'vitest'
import { createVolatile, updateVolatile } from '@deepseek-ai/cosmokit'
import { Config } from '../src/index.js'
import { boot } from './harness.js'

describe('editable connector parameters', () => {
  it('exposes the Plugins-page fields as volatile values', () => {
    const config = Config({ botToken: 'a:token', allowedUserIds: [1, 2] })
    expect(typeof config.botToken.get).toBe('function')
    expect(typeof config.allowedUserIds.get).toBe('function')
    expect(typeof config.adminUserId.get).toBe('function')
    expect(config.botToken.get()).toBe('a:token')
    expect(config.allowedUserIds.get()).toEqual([1, 2])
  })

  it('a volatile bot token update reaches the running poller', async () => {
    const harness = await boot()
    try {
      updateVolatile(harness.config.botToken, createVolatile('next:token'))
      harness.ctx.emit('loader/volatile-update', [['botToken']])
      await harness.waitFor(
        () => harness.calls.some((call) => call.method === 'getUpdates' && call.url.includes('/botnext:token/')),
        'a poll with the new token',
        3000,
      )
    } finally {
      await harness.dispose()
    }
  })
})
