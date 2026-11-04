/**
 * Tests for the topic↔session map.
 *
 * `bindings.json` is the connector's whole state, and the review found ordinary
 * documented commands corrupting it: a second tap on the startgroup link
 * deleted a group's topics, a group could be stolen from another workspace, and
 * a move left the old group's sessions pointing at a topic nobody watches.
 * These drive the real plugin through the same messages a user sends.
 */

import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  boot,
  callText,
  makeBindings,
  CHAT_ID,
  SESSION_ID,
  THREAD_ID,
  WORKSPACE_ID,
  type Harness,
} from './harness.js'

const OTHER_CHAT = -1009999999999
const active: Harness[] = []

afterEach(async () => {
  while (active.length > 0) {
    const harness = active.pop()
    if (harness !== undefined) await harness.dispose()
  }
})

async function start(harness: Harness): Promise<Harness> {
  active.push(harness)
  return harness
}

const bindings = async (harness: Harness): Promise<{ workspaces: Record<string, { chatId: number }>; sessions: Record<string, { sessionId: string }> }> =>
  JSON.parse(await readFile(harness.bindingsFile, 'utf8')) as {
    workspaces: Record<string, { chatId: number }>
    sessions: Record<string, { sessionId: string }>
  }

describe('binding a group to a workspace', () => {
  it('re-linking the same workspace changes nothing and deletes no topic', async () => {
    // The documented first-run link can be tapped again; it used to delete
    // every topic in the group, dispose live agents and drop the bindings.
    const harness = await start(await boot())
    harness.pushUpdate(harness.makeUpdate({ text: `/start workspace_${WORKSPACE_ID}` }))
    const dashboard = await harness.waitFor(
      () => harness.sent.find((call) => callText(call).includes('Test Workspace')),
      'the dashboard after re-linking',
      6000,
    )
    expect(dashboard.params.chat_id).toBe(CHAT_ID)
    expect(harness.calls.some((call) => call.method === 'deleteForumTopic')).toBe(false)
    const state = await bindings(harness)
    expect(state.workspaces[WORKSPACE_ID]?.chatId).toBe(CHAT_ID)
    expect(state.sessions[`${CHAT_ID}:${THREAD_ID}`]?.sessionId).toBe(SESSION_ID)
  }, 20_000)

  it('refuses a group that already hosts another workspace instead of seizing it', async () => {
    // Seeded before boot: the plugin reads bindings once, at start.
    const dir = await mkdtemp(join(tmpdir(), 'dsh-binding-'))
    const workspaceRoot = join(dir, 'workspace')
    const seeded = makeBindings(workspaceRoot)
    seeded.workspaces['ws-two'] = { ...seeded.workspaces[WORKSPACE_ID]!, chatId: OTHER_CHAT, title: 'Other' }
    const harness = await start(await boot({ workspaceRoot }, { dir, bindings: seeded }))

    // The link for the Test Workspace is tapped in a group that already hosts
    // ws-two: that group belongs to ws-two and must not be taken over.
    harness.pushUpdate(harness.makeUpdate({ text: `/start workspace_${WORKSPACE_ID}`, chatId: OTHER_CHAT, threadId: 0 }))
    const refusal = await harness.waitFor(
      () => harness.sent.find((call) => callText(call).includes('already hosts')),
      'the refusal for a group that hosts another workspace',
      6000,
    )
    expect(callText(refusal)).toContain('ws-two')
    // Nothing was unregistered and no topic was deleted.
    const after = await bindings(harness)
    expect(after.workspaces['ws-two']?.chatId).toBe(OTHER_CHAT)
    expect(after.workspaces[WORKSPACE_ID]?.chatId).toBe(CHAT_ID)
    expect(harness.calls.some((call) => call.method === 'deleteForumTopic')).toBe(false)
  }, 20_000)

  it('moving a workspace clears the old group without deleting its history', async () => {
    const harness = await start(await boot())
    harness.pushUpdate(harness.makeUpdate({ text: `/start workspace_${WORKSPACE_ID}`, chatId: OTHER_CHAT, threadId: 0 }))
    await harness.waitFor(
      () => harness.sent.find((call) => call.params.chat_id === OTHER_CHAT && callText(call).includes('Test Workspace')),
      'the dashboard in the new group',
      6000,
    )
    const after = await bindings(harness)
    expect(after.workspaces[WORKSPACE_ID]?.chatId).toBe(OTHER_CHAT)
    // The old topic binding is gone: `bindingForSession` must not keep pointing
    // the mirror at a group the workspace has left.
    expect(after.sessions[`${CHAT_ID}:${THREAD_ID}`]).toBeUndefined()
    // The old group is told, and its topics are not deleted.
    await harness.waitFor(
      () => harness.sent.find((call) => call.params.chat_id === CHAT_ID && /no longer hosts/.test(callText(call))),
      'the notice in the old group',
      6000,
    )
    expect(harness.calls.some((call) => call.method === 'deleteForumTopic' && call.params.message_thread_id === THREAD_ID)).toBe(false)
  }, 20_000)
})

describe('session bookkeeping', () => {
  it('/unarchive reuses the session\'s topic instead of binding it twice', async () => {
    // /close archived the session but kept its topic, so unarchiving used to
    // mint a second topic and leave `bindingForSession` pointing at the old one.
    const harness = await start(await boot())
    harness.registry.archivedSessionIds.push(SESSION_ID)
    harness.pushUpdate(harness.makeUpdate({ text: `/unarchive ${SESSION_ID}`, threadId: 0 }))
    const reply = await harness.waitFor(
      () => harness.sent.find((call) => callText(call).includes('existing topic')),
      'the unarchive reply',
      6000,
    )
    expect(callText(reply)).toContain(String(THREAD_ID))
    expect(harness.calls.some((call) => call.method === 'createForumTopic')).toBe(false)
    const state = await bindings(harness)
    expect(Object.keys(state.sessions)).toHaveLength(1)
  }, 20_000)

  it('/sync keeps a healthy topic when the probe fails transiently', async () => {
    // A 5xx used to count as "topic deleted": the binding was dropped, the agent
    // leaked, and a duplicate topic was created next to a healthy one.
    const harness = await start(await boot({}, {
      failSend: (call) => (call.method === 'sendMessage' && call.params.text === '.' ? 'Bad Gateway' : undefined),
    }))
    harness.registry.attached.push(SESSION_ID)
    harness.pushUpdate(harness.makeUpdate({ text: '/sync', threadId: 0 }))
    const reply = await harness.waitFor(
      () => harness.sent.find((call) => callText(call).includes('could not be probed')),
      'the sync summary that reports the kept topic',
      8000,
    )
    expect(callText(reply)).toContain('0 dead binding')
    const state = await bindings(harness)
    expect(state.sessions[`${CHAT_ID}:${THREAD_ID}`]?.sessionId).toBe(SESSION_ID)
    expect(harness.calls.some((call) => call.method === 'createForumTopic')).toBe(false)
  }, 20_000)
})

describe('who may administer', () => {
  it('refuses /system update to anyone but the admin, and still answers /system status', async () => {
    const harness = await start(await boot({ adminUserId: 7 }))
    // 42 is allowed to use the agent, 7 is the admin.
    harness.pushUpdate(harness.makeUpdate({ text: '/system update setup', chatId: 42, threadId: 0, extra: { chat: { id: 42, type: 'private', first_name: 'Tester' }, is_topic_message: false, message_thread_id: undefined } }))
    const refusal = await harness.waitFor(
      () => harness.sent.find((call) => callText(call).includes('only admin 7')),
      'the admin refusal',
      6000,
    )
    expect(callText(refusal)).toContain('changes the deployment for everyone')
    // Read-only is still available to everyone.
    harness.pushUpdate(harness.makeUpdate({ text: '/system status', chatId: 42, threadId: 0, extra: { chat: { id: 42, type: 'private', first_name: 'Tester' }, is_topic_message: false, message_thread_id: undefined } }))
    await harness.waitFor(
      () => harness.sent.find((call) => callText(call).includes('dsh-telegram-connector')),
      'the status text for a normal user',
      6000,
    )
  }, 20_000)

  it('falls back to the chat owner when no admin is configured', async () => {
    // An upgraded deployment has no DSH_ADMIN_USER_ID; the owner of the control
    // chat must still be able to administer it, or the upgrade locks them out.
    const harness = await start(await boot())
    harness.pushUpdate(harness.makeUpdate({ text: '/system restart now', chatId: 42, threadId: 0, extra: { chat: { id: 42, type: 'private', first_name: 'Tester' }, is_topic_message: false, message_thread_id: undefined } }))
    const answer = await harness.waitFor(
      () => harness.sent.find((call) => /only |restart/i.test(callText(call))),
      'an answer to the restart request',
      6000,
    )
    // It may fail for lack of a supervisor, but it must not be a permission wall.
    expect(callText(answer)).not.toContain('changes the deployment for everyone')
  }, 20_000)
})

describe('the command menu is published', () => {
  it('sets a private and a group menu at boot', async () => {
    const harness = await start(await boot())
    await harness.waitFor(
      () => harness.calls.filter((call) => call.method === 'setMyCommands').length >= 2,
      'both setMyCommands calls',
      6000,
    )
    const calls = harness.calls.filter((call) => call.method === 'setMyCommands')
    const scopes = calls.map((call) => (call.params.scope as { type?: string } | undefined)?.type ?? 'default')
    expect(scopes).toContain('default')
    expect(scopes).toContain('all_group_chats')
    const commands = calls[0]!.params.commands as { command: string }[]
    expect(commands.some((entry) => entry.command === 'system')).toBe(true)
  }, 20_000)
})

describe('the control chat', () => {
  it('stays where it was claimed, and the admin can move it deliberately', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-control-'))
    const workspaceRoot = join(dir, 'workspace')
    const seeded = makeBindings(workspaceRoot)
    // 43 is the admin; 42 is an ordinary allowed user.
    const harness = await start(await boot({ workspaceRoot, adminUserId: 43, allowedUserIds: [42, 43] }, { dir, bindings: seeded }))
    const from = (chatId: number, text: string) => harness.makeUpdate({
      text,
      chatId,
      userId: chatId,
      threadId: 0,
      extra: { chat: { id: chatId, type: 'private' }, is_topic_message: false },
    })

    // The first DM claims the control chat, whoever sent it.
    harness.pushUpdate(from(42, '/system status'))
    await harness.waitFor(() => harness.sent.some((call) => call.params.chat_id === 42), 'the first answer', 6000)

    // The admin writes from their own DM: that alone must not move it, or the
    // notices would follow whoever wrote last.
    harness.pushUpdate(from(43, '/system status'))
    await harness.waitFor(() => harness.sent.some((call) => call.params.chat_id === 43), 'the admin answer', 6000)
    let state = JSON.parse(await readFile(harness.bindingsFile, 'utf8')) as { controlChatId?: number }
    expect(state.controlChatId).toBe(42)

    // Moving it is explicit.
    harness.pushUpdate(from(43, '/system takechat'))
    await harness.waitFor(
      () => harness.sent.find((call) => callText(call).includes('now the control chat')),
      'the takechat confirmation',
      6000,
    )
    state = JSON.parse(await readFile(harness.bindingsFile, 'utf8')) as { controlChatId?: number }
    expect(state.controlChatId).toBe(43)
  }, 25_000)
})

describe('binding is administration', () => {
  it('refuses /bind from a user who is not the admin', async () => {
    const harness = await start(await boot({ adminUserId: 7 }))
    harness.pushUpdate(harness.makeUpdate({ text: `/bind ${WORKSPACE_ID}`, chatId: OTHER_CHAT, threadId: 0 }))
    const refusal = await harness.waitFor(
      () => harness.sent.find((call) => callText(call).includes('only admin 7')),
      'the admin refusal for /bind',
      6000,
    )
    expect(callText(refusal)).toContain('changes the deployment for everyone')
  }, 20_000)
})

describe('/system status honesty', () => {
  it('shows the runtime registry and the data directory next to the web and key lines', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-status-'))
    const dataRoot = await mkdtemp(join(tmpdir(), 'dsh-status-root-'))
    const harness = await start(await boot({}, { dir, dataRoot, instanceId: 'status-test' }))
    harness.pushUpdate(harness.makeUpdate({ text: '/system status', chatId: 42, threadId: 0, extra: { chat: { id: 42, type: 'private', first_name: 'Tester' }, is_topic_message: false, message_thread_id: undefined } }))
    const status = await harness.waitFor(
      () => harness.sent.find((call) => callText(call).includes('registry:')),
      '/system status',
      6000,
    )
    const text = callText(status)
    // Both lists, so a disagreement is visible before a prompt fails.
    expect(text).toMatch(/registry: 1 workspace\(s\) in the runtime · 1 bound to Telegram/)
    // A marker from another live runtime would be named here; with none, the
    // line still reports the directory it checked.
    expect(text).toContain(`data: ${dataRoot}`)
  }, 20_000)
})
