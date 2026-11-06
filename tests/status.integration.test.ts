/**
 * `/system status` must probe the address the runtime advertises.
 *
 * The setup binds the LAN address only (`--host 192.168.2.98`), so a hardcoded
 * loopback probe reports "unreachable" while the Web UI is answering. This
 * drives the real status handler with a fake web app and no network.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { boot, callText, USER_ID, type Harness } from './harness.js'

const active: Harness[] = []

afterEach(async () => {
  while (active.length > 0) await active.pop()?.dispose()
})

const privateUpdate = (harness: Harness, text: string) => harness.makeUpdate({
  text,
  chatId: USER_ID,
  threadId: 0,
  extra: {
    chat: { id: USER_ID, type: 'private', first_name: 'Admin' },
    is_topic_message: false,
    message_thread_id: undefined,
  },
})

describe('web status probe', () => {
  it('probes the advertised host rather than loopback', async () => {
    const harness = await boot(
      { adminUserId: USER_ID, allowedUserIds: [USER_ID] },
      { services: { webApp: { getAdvertisedUrl: () => 'http://192.0.2.10:4310/' } } },
    )
    active.push(harness)
    harness.pushUpdate(privateUpdate(harness, '/system status'))
    const answer = await harness.waitFor(
      () => harness.sent.find((call) => callText(call).includes('answered')),
      'the web probe line',
      6000,
    )
    const text = callText(answer)
    expect(text).toContain('web: 192.0.2.10:4310 answered 200')
    expect(text).not.toContain('127.0.0.1:4310 answered unreachable')
  }, 20_000)

  it('falls back to loopback when the runtime advertises nothing', async () => {
    const harness = await boot({ adminUserId: USER_ID, allowedUserIds: [USER_ID] })
    active.push(harness)
    harness.pushUpdate(privateUpdate(harness, '/system status'))
    const answer = await harness.waitFor(
      () => harness.sent.find((call) => callText(call).includes('answered')),
      'the loopback probe line',
      6000,
    )
    expect(callText(answer)).toContain('web: 127.0.0.1:4310 answered')
  }, 20_000)
})
