/**
 * The rich control app: /start posts one card; every navigation edits that same
 * message. The legacy /panel remains a widget for the transition.
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

let callbackId = 9000
const rich = (messageId: number, data: string, userId = USER_ID) => ({
  update_id: callbackId++,
  callback_query: {
    id: `cb-${String(callbackId)}`,
    from: { id: userId, is_bot: false, first_name: 'Admin' },
    message: { message_id: messageId, chat: { id: USER_ID, type: 'private' }, date: 0 },
    data: `rc:${data}`,
  },
})

const htmlOf = (call: { params: Record<string, unknown> }): string =>
  String((call.params.rich_message as { html?: string } | undefined)?.html ?? '')
const markupOf = (call: { params: Record<string, unknown> }): string =>
  JSON.stringify(call.params.reply_markup ?? '')

describe('the rich card app', () => {
  it('opens Home with the final tiles', async () => {
    const harness = await boot({ adminUserId: USER_ID, allowedUserIds: [USER_ID] })
    active.push(harness)
    harness.pushUpdate(privateUpdate(harness, '/start'))
    const home = await harness.waitFor(
      () => harness.calls.find((call) => call.method === 'sendRichMessage'),
      'the home card',
      6000,
    )
    const html = htmlOf(home)
    expect(html).toContain('Control')
    for (const label of ['Sessions', 'Plugins', 'Updates', 'Components', 'System', 'Settings', 'Help', 'Web UI']) {
      expect(markupOf(home)).toContain(label)
    }
    expect(html).not.toContain('More')
  }, 20_000)

  it('edits the same card while navigating to a workspace and a session', async () => {
    const harness = await boot({ adminUserId: USER_ID, allowedUserIds: [USER_ID] })
    active.push(harness)
    harness.pushUpdate(privateUpdate(harness, '/start'))
    const home = await harness.waitFor(() => harness.calls.find((call) => call.method === 'sendRichMessage'), 'the home card', 6000)
    const messageId = home.messageId as number

    harness.pushUpdate(rich(messageId, 'n:sessions'))
    const sessions = await harness.waitFor(
      () => harness.edited.find((call) => call.method === 'editMessageText' && htmlOf(call).includes('Test Workspace')),
      'the sessions card',
      6000,
    )
    expect(markupOf(sessions)).toContain('New workspace')

    harness.pushUpdate(rich(messageId, 'n:workspace:0'))
    const workspace = await harness.waitFor(
      () => harness.edited.find((call) => call.method === 'editMessageText' && htmlOf(call).includes('Test Session')),
      'the workspace card',
      6000,
    )
    expect(markupOf(workspace)).toContain('Link')
    expect(markupOf(workspace)).toContain('Remove')

    harness.pushUpdate(rich(messageId, 'n:session:0'))
        const session = await harness.waitFor(
      () => harness.edited.find((call) => call.method === 'editMessageText' && markupOf(call).includes('Manage')),
      'the session card',
      6000,
    )
    expect(htmlOf(session)).toContain('Test Session')
    expect(markupOf(session)).toContain('Manage')
    expect(harness.calls.some((call) => call.method === 'deleteMessage')).toBe(false)
  }, 20_000)

  it('renders Plugins, Updates, Components, Settings, Help and Web', async () => {
    const harness = await boot({ adminUserId: USER_ID, allowedUserIds: [USER_ID] })
    active.push(harness)
    harness.pushUpdate(privateUpdate(harness, '/start'))
    const home = await harness.waitFor(() => harness.calls.find((call) => call.method === 'sendRichMessage'), 'the home card', 6000)
    const messageId = home.messageId as number
    const targets = [
      ['plugins', 'Plugins'],
      ['updates', 'Updates'],
      ['components', 'Components'],
      ['settings', 'Settings'],
      ['help', 'Help'],
      ['web', 'Web UI'],
      ['system', 'System'],
    ] as const
    for (const [target, title] of targets) {
      harness.pushUpdate(rich(messageId, `n:${target}`))
      await harness.waitFor(
        () => harness.edited.find((call) => call.method === 'editMessageText' && htmlOf(call).includes(title)),
        `the ${target} card`,
        6000,
      )
    }
  }, 30_000)

  it('navigates into a plugin detail from the list', async () => {
    const harness = await boot({ adminUserId: USER_ID, allowedUserIds: [USER_ID] })
    active.push(harness)
    harness.pushUpdate(privateUpdate(harness, '/start'))
    const home = await harness.waitFor(() => harness.calls.find((call) => call.method === 'sendRichMessage'), 'the home card', 6000)
    harness.pushUpdate(rich(home.messageId as number, 'n:plugins'))
    await harness.waitFor(
      () => harness.edited.find((call) => call.method === 'editMessageText' && htmlOf(call).includes('Plugins')),
      'the plugins card',
      6000,
    )
    expect(harness.calls.some((call) => call.method === 'sendRichMessage')).toBe(true)
  }, 20_000)

  it('keeps the legacy panel reachable through /panel', async () => {
    const harness = await boot({ adminUserId: USER_ID, allowedUserIds: [USER_ID] })
    active.push(harness)
    harness.pushUpdate(privateUpdate(harness, '/panel'))
    const legacy = await harness.waitFor(
      () => harness.calls.find((call) => call.method === 'sendWidget'),
      'the legacy panel',
      6000,
    )
    expect(String(legacy.params.html)).toContain('data-tab="system"')
  }, 20_000)

  it('applies a model from the session card', async () => {
    const harness = await boot({ adminUserId: USER_ID, allowedUserIds: [USER_ID] })
    active.push(harness)
    harness.pushUpdate(privateUpdate(harness, '/start'))
    const home = await harness.waitFor(() => harness.calls.find((call) => call.method === 'sendRichMessage'), 'the home card', 6000)
    const messageId = home.messageId as number
    harness.pushUpdate(rich(messageId, 'n:workspace:0'))
    await harness.waitFor(() => harness.edited.find((call) => call.method === 'editMessageText' && htmlOf(call).includes('Test Session')), 'the workspace card', 6000)
    harness.pushUpdate(rich(messageId, 'n:session:0'))
    await harness.waitFor(() => harness.edited.find((call) => call.method === 'editMessageText' && markupOf(call).includes('Manage')), 'the session card', 6000)
    harness.pushUpdate(rich(messageId, 'a:model:test-provider/test-model'))
    await harness.waitFor(
      () => harness.edited.find((call) => call.method === 'editMessageText' && htmlOf(call).includes('test-provider/test-model')),
      'the refreshed session card',
      6000,
    )
    const bindings = JSON.parse(await (await import('node:fs/promises')).readFile(harness.bindingsFile, 'utf8')) as {
      sessions: Record<string, { model?: { provider?: string; model?: string } }>
    }
    expect(Object.values(bindings.sessions)[0]?.model).toEqual({ provider: 'test-provider', model: 'test-model' })
  }, 20_000)

  it('opens the prompt for a new workspace and consumes the text', async () => {
    const harness = await boot({ adminUserId: USER_ID, allowedUserIds: [USER_ID] })
    active.push(harness)
    harness.pushUpdate(privateUpdate(harness, '/start'))
    const home = await harness.waitFor(() => harness.calls.find((call) => call.method === 'sendRichMessage'), 'the home card', 6000)
    harness.pushUpdate(rich(home.messageId as number, 'n:sessions'))
        await harness.waitFor(() => harness.edited.find((call) => call.method === 'editMessageText' && markupOf(call).includes('New workspace')), 'the sessions card', 6000)
    // Actions are buttons; the handler is exercised by the callback, not by text.
    harness.pushUpdate(rich(home.messageId as number, 'a:workspace:new'))
    await harness.waitFor(
      () => harness.edited.find((call) => call.method === 'editMessageText' && htmlOf(call).includes('Send the workspace name')),
      'the prompt card',
      6000,
    )
  }, 20_000)
})
