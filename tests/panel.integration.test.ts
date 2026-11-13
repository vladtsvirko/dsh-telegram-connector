/**
 * `/panel` and the widget round trip.
 *
 * A widget is a message whose only way back is a `widget_query` update: the
 * bot answers within 15 seconds, and the answer must fit 1024 bytes. These
 * tests drive the real poll loop and the real handlers, with the fake Bot API
 * recording the calls.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { boot, callText, USER_ID, WORKSPACE_ID, type Harness } from './harness.js'

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

describe('the live panel', () => {
  it('posts an interactive widget into the control chat', async () => {
    const harness = await boot({ adminUserId: USER_ID, allowedUserIds: [USER_ID] })
    active.push(harness)
    harness.pushUpdate(privateUpdate(harness, '/panel'))
    const call = await harness.waitFor(
      () => harness.calls.find((entry) => entry.method === 'sendWidget'),
      'the widget',
      6000,
    )
    expect(call.params.chat_id).toBe(USER_ID)
    const html = String(call.params.html)
    expect(html).toContain('Test Workspace')
    expect(html).toContain('https://t.me/c/1234567890')
    expect(html).toContain('Refresh')
    expect(String(call.params.caption)).toContain('workspace')
    expect(call.params.allow_queries).toBe(true)
  }, 20_000)

  it('answers a background status request with a bounded snapshot', async () => {
    const harness = await boot({ adminUserId: USER_ID, allowedUserIds: [USER_ID] })
    active.push(harness)
    harness.pushUpdate({
      update_id: 9001,
      widget_query: {
        id: 'wq-1',
        from: { id: USER_ID, is_bot: false, first_name: 'Admin' },
        data: 'status',
      },
    })
    const answer = await harness.waitFor(() => harness.widgetAnswered[0], 'the widget answer', 6000)
    expect(answer.params.widget_query_id).toBe('wq-1')
    const payload = JSON.parse(String(answer.params.data)) as {
      t: string
      ws: number
      se: number
      w: { i: string; t: string }[]
    }
    expect(payload.t).toBe('s')
    expect(payload.ws).toBe(1)
    expect(payload.w[0]?.i).toBe(WORKSPACE_ID.slice(0, 8))
    expect(Buffer.byteLength(String(answer.params.data), 'utf8')).toBeLessThanOrEqual(1024)
  }, 20_000)

  it('refuses an unauthorized viewer without leaking state', async () => {
    const harness = await boot({ adminUserId: USER_ID, allowedUserIds: [USER_ID] })
    active.push(harness)
    harness.pushUpdate({
      update_id: 9002,
      widget_query: {
        id: 'wq-2',
        from: { id: 777, is_bot: false, first_name: 'Stranger' },
        data: 'status',
      },
    })
    const answer = await harness.waitFor(() => harness.widgetAnswered[0], 'the refusal', 6000)
    expect(JSON.parse(String(answer.params.data))).toEqual({ t: 'e', m: 'not authorized' })
  }, 20_000)

  it('falls back to the text menu when the client cannot show widgets', async () => {
    const harness = await boot(
      { adminUserId: USER_ID, allowedUserIds: [USER_ID] },
      { failSend: (call) => (call.method === 'sendWidget' ? 'Bad Request: widgets are not supported here' : undefined) },
    )
    active.push(harness)
    harness.pushUpdate(privateUpdate(harness, '/panel'))
    const menu = await harness.waitFor(
      () => harness.sent.find((call) => callText(call).includes('/system status')),
      'the text card',
      6000,
    )
    expect(callText(menu)).toContain('<b>menu</b>')
    expect(harness.calls.some((call) => call.method === 'sendWidget')).toBe(true)
  }, 20_000)
})
