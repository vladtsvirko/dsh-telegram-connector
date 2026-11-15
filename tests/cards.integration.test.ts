/**
 * The card app: /start opens Home, and `n:` navigates by deleting the current
 * card and sending the next one. The chat keeps exactly one screen.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { boot, callText, USER_ID, WORKSPACE_ID, SESSION_ID, type Harness } from './harness.js'

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

const query = (id: string, data: string, userId = USER_ID): { update_id: number; widget_query: { id: string; from: { id: number; is_bot: false; first_name: string }; chat: { id: number; type: 'private' }; data: string } } => ({
  update_id: Math.floor(Math.random() * 1_000_000) + 900_000,
  widget_query: {
    id,
    from: { id: userId, is_bot: false, first_name: 'Admin' },
    chat: { id: USER_ID, type: 'private' },
    data,
  },
})

describe('the card app', () => {
  it('opens Home and replaces it when navigating', async () => {
    const harness = await boot({ adminUserId: USER_ID, allowedUserIds: [USER_ID] })
    active.push(harness)

    harness.pushUpdate(privateUpdate(harness, '/start'))
    const home = await harness.waitFor(
      () => harness.calls.find((call) => call.method === 'sendWidget'),
      'the home card',
      6000,
    )
    const homeHtml = String(home.params.html)
    expect(homeHtml).toContain('Sessions')
    expect(homeHtml).toContain('System')
    expect(homeHtml).toContain('More')

    harness.pushUpdate(query('q1', 'n:sessions'))
    await harness.waitFor(
      () => harness.calls.filter((call) => call.method === 'sendWidget').length >= 2,
      'the sessions card',
      6000,
    )
    const cards = harness.calls.filter((call) => call.method === 'sendWidget')
    expect(String(cards[1]?.params.html)).toContain('Test Workspace')
    const deleted = harness.calls.find((call) => call.method === 'deleteMessage')
    expect(deleted?.params.message_id).toBe(home.messageId)
  }, 20_000)

  it('navigates into a workspace and a session', async () => {
    const harness = await boot({ adminUserId: USER_ID, allowedUserIds: [USER_ID] })
    active.push(harness)
    harness.pushUpdate(privateQuery('q2', 'n:workspace:0'))
    await harness.waitFor(
      () => harness.calls.find((call) => call.method === 'sendWidget'),
      'the workspace card',
      6000,
    )
    expect(String(harness.calls.find((call) => call.method === 'sendWidget')?.params.html)).toContain('Test Session')

    harness.pushUpdate(privateQuery('q3', 'n:session:0'))
    await harness.waitFor(
      () => harness.calls.filter((call) => call.method === 'sendWidget').length >= 2,
      'the session card',
      6000,
    )
    const html = String(harness.calls.filter((call) => call.method === 'sendWidget')[1]?.params.html)
    expect(html).toContain('Test Session')
    expect(html).toContain('Forget')
  }, 20_000)

  it('falls back to rich cards while Telegram has widgets disabled', async () => {
    const harness = await boot(
      { adminUserId: USER_ID, allowedUserIds: [USER_ID] },
      { failSend: (call) => (call.method === 'sendWidget' ? 'Bad Request: INPUT_MEDIA_WIDGET_NOT_ALLOWED' : undefined) },
    )
    active.push(harness)
    harness.pushUpdate(privateUpdate(harness, '/start'))
    const rich = await harness.waitFor(
      () => harness.calls.find((call) => call.method === 'sendRichMessage'),
      'the rich card',
      6000,
    )
    const richMessage = rich.params.rich_message as { html?: string }
    expect(String(richMessage.html)).toContain('Control')
    expect(JSON.stringify(rich.params.reply_markup)).toContain('Sessions')
    expect(rich.params.reply_markup).toBeTruthy()
    expect(harness.sent.some((call) => callText(call).includes('<b>menu</b>'))).toBe(false)

    const attempts = harness.calls.filter((call) => call.method === 'sendWidget').length
    expect(attempts).toBe(1)
    harness.pushUpdate(privateUpdate(harness, '/start'))
    await harness.waitFor(
      () => harness.calls.filter((call) => call.method === 'sendRichMessage').length >= 2,
      'the second rich card',
      6000,
    )
    expect(harness.calls.filter((call) => call.method === 'sendWidget').length).toBe(attempts)
  }, 20_000)

  it('navigates a rich card in place', async () => {
    const harness = await boot(
      { adminUserId: USER_ID, allowedUserIds: [USER_ID] },
      { failSend: (call) => (call.method === 'sendWidget' ? 'Bad Request: INPUT_MEDIA_WIDGET_NOT_ALLOWED' : undefined) },
    )
    active.push(harness)
    harness.pushUpdate(privateUpdate(harness, '/start'))
    const rich = await harness.waitFor(
      () => harness.calls.find((call) => call.method === 'sendRichMessage'),
      'the rich card',
      6000,
    )
    const messageId = rich.messageId
    expect(messageId).toBeTruthy()
    harness.pushUpdate({
      update_id: 9400,
      callback_query: {
        id: 'cb-rich-1',
        from: { id: USER_ID, is_bot: false, first_name: 'Admin' },
        message: {
          message_id: messageId as number,
          chat: { id: USER_ID, type: 'private' },
          date: 0,
        },
        data: 'rc:n:sessions',
      },
    })
    const edited = await harness.waitFor(
      () => harness.edited.find((call) => call.method === 'editMessageText'),
      'the edited rich card',
      6000,
    )
    const html = String((edited.params.rich_message as { html?: string }).html)
    expect(html).toContain('Test Workspace')
    expect(edited.params.reply_markup).toBeTruthy()
  }, 20_000)

  it('keeps the legacy panel reachable during the transition', async () => {
    const harness = await boot({ adminUserId: USER_ID, allowedUserIds: [USER_ID] })
    active.push(harness)
    harness.pushUpdate(privateQuery('q4', 'n:panel'))
    const legacy = await harness.waitFor(
      () => harness.calls.find((call) => call.method === 'sendWidget'),
      'the legacy panel',
      6000,
    )
    expect(String(legacy.params.html)).toContain('data-tab="system"')
  }, 20_000)

  it('answers confirmation and refusal for a restart', async () => {
    const harness = await boot({ adminUserId: USER_ID, allowedUserIds: [USER_ID, 777] })
    active.push(harness)
    harness.pushUpdate(query('q5', 'a:restart'))
    const admin = await harness.waitFor(() => harness.widgetAnswered[0], 'the admin answer', 6000)
    // The harness has no supervisor, so the admin reaches that guard.
    expect(JSON.parse(String(admin.params.data))).toEqual({ k: 'err', m: 'this runtime has no supervisor' })

    harness.pushUpdate(query('q6', 'a:restart', 777))
    const colleague = await harness.waitFor(() => harness.widgetAnswered[1], 'the refusal', 6000)
    expect(JSON.parse(String(colleague.params.data))).toEqual({ k: 'err', m: 'only the admin can restart' })
  }, 20_000)

  it('applies a model and navigates to the refreshed session', async () => {
    const harness = await boot({ adminUserId: USER_ID, allowedUserIds: [USER_ID] })
    active.push(harness)
    // The session card carries the context the short model action needs.
    harness.pushUpdate(privateQuery('q7', 'n:workspace:0'))
    await harness.waitFor(() => harness.calls.find((call) => call.method === 'sendWidget'), 'the workspace card', 6000)
    harness.pushUpdate(privateQuery('q8', 'n:session:0'))
    await harness.waitFor(() => harness.calls.filter((call) => call.method === 'sendWidget').length >= 2, 'the session card', 6000)
    harness.pushUpdate(query('q9', 'a:model:test-provider/test-model'))
    const answer = await harness.waitFor(
      () => harness.widgetAnswered.find((entry) => {
        try { return (JSON.parse(String(entry.params.data)) as { k?: string }).k === 'n' } catch { return false }
      }),
      'the model answer',
      6000,
    )
    expect(JSON.parse(String(answer.params.data))).toEqual({ k: 'n', t: 'session' })
    const bindings = JSON.parse(await (await import('node:fs/promises')).readFile(harness.bindingsFile, 'utf8')) as {
      sessions: Record<string, { model?: { provider?: string; model?: string } }>
    }
    expect(Object.values(bindings.sessions)[0]?.model).toEqual({ provider: 'test-provider', model: 'test-model' })
  }, 20_000)
})

function privateQuery(id: string, data: string) {
  return query(id, data)
}
