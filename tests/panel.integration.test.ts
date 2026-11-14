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
    expect(html).toContain('data-tab="spaces"')
    expect(html).toContain('data-tab="system"')
    expect(String(call.params.caption)).toContain('workspace')
    expect(call.params.allow_queries).toBe(true)
  }, 20_000)

  it('opens the control center from /start', async () => {
    const harness = await boot({ adminUserId: USER_ID, allowedUserIds: [USER_ID] })
    active.push(harness)
    harness.pushUpdate(privateUpdate(harness, '/start'))
    const call = await harness.waitFor(
      () => harness.calls.find((entry) => entry.method === 'sendWidget'),
      'the control center',
      6000,
    )
    expect(String(call.params.html)).toContain('data-tab="system"')
  }, 20_000)

  it('answers a status request with a bounded snapshot', async () => {
    const harness = await boot({ adminUserId: USER_ID, allowedUserIds: [USER_ID] })
    active.push(harness)
    harness.pushUpdate({
      update_id: 9001,
      widget_query: {
        id: 'wq-1',
        from: { id: USER_ID, is_bot: false, first_name: 'Admin' },
        data: 's',
      },
    })
    const answer = await harness.waitFor(() => harness.widgetAnswered[0], 'the widget answer', 6000)
    expect(answer.params.widget_query_id).toBe('wq-1')
    const payload = JSON.parse(String(answer.params.data)) as {
      k: string
      ws: number
      se: number
    }
    expect(payload.k).toBe('s')
    expect(payload.ws).toBe(1)
    expect(payload.se).toBe(1)
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
        data: 's',
      },
    })
    const answer = await harness.waitFor(() => harness.widgetAnswered[0], 'the refusal', 6000)
    expect(JSON.parse(String(answer.params.data))).toEqual({ k: 'err', m: 'not authorized' })
  }, 20_000)

  it('replaces the previous control center instead of stacking them', async () => {
    const harness = await boot({ adminUserId: USER_ID, allowedUserIds: [USER_ID] })
    active.push(harness)
    harness.pushUpdate(privateUpdate(harness, '/start'))
    const first = await harness.waitFor(
      () => harness.calls.find((entry) => entry.method === 'sendWidget'),
      'the first control center',
      6000,
    )
    harness.pushUpdate(privateUpdate(harness, '/start'))
    await harness.waitFor(
      () => harness.calls.filter((entry) => entry.method === 'sendWidget').length >= 2,
      'the second control center',
      6000,
    )
    const deleted = harness.calls.find((entry) => entry.method === 'deleteMessage')
    expect(deleted?.params.message_id).toBe(first.messageId)
  }, 20_000)

  it('refuses a plugin toggle from a non-admin', async () => {
    const harness = await boot({ adminUserId: USER_ID, allowedUserIds: [USER_ID, 777] })
    active.push(harness)
    harness.pushUpdate({
      update_id: 9004,
      widget_query: {
        id: 'wq-4',
        from: { id: 777, is_bot: false, first_name: 'Colleague' },
        data: 'a:l:dsh-penpot-plugin:off',
      },
    })
    const answer = await harness.waitFor(() => harness.widgetAnswered[0], 'the refusal', 6000)
    expect(JSON.parse(String(answer.params.data))).toEqual({ k: 'err', m: 'only the admin can change plugins' })
  }, 20_000)

  it('refuses a restart from a non-admin', async () => {
    const harness = await boot({ adminUserId: USER_ID, allowedUserIds: [USER_ID, 777] })
    active.push(harness)
    harness.pushUpdate({
      update_id: 9003,
      widget_query: {
        id: 'wq-3',
        from: { id: 777, is_bot: false, first_name: 'Colleague' },
        data: 'a:rst',
      },
    })
    const answer = await harness.waitFor(() => harness.widgetAnswered[0], 'the refusal', 6000)
    expect(JSON.parse(String(answer.params.data))).toEqual({ k: 'err', m: 'only the admin can restart' })
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
