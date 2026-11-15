/**
 * A group may host several workspaces. The topic→workspace relation is then
 * carried by the `[Workspace]` prefix, and `/sync` must adopt every active
 * session in every attached workspace while skipping archived ones.
 */

import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeRegistry, boot, callText, makeBindings, CHAT_ID, SESSION_ID, THREAD_ID, WORKSPACE_ID, type Harness } from './harness.js'

const active: Harness[] = []
const OTHER_ID = 'ws-new-1'
const OTHER_THREAD = 88

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

interface State {
  workspaces: Record<string, { chatId: number; path: string; title: string }>
  sessions: Record<string, { workspaceId: string; sessionId: string; title?: string; topicTitle?: string }>
  topicTitles?: Record<string, string>
}

const stateOf = async (harness: Harness): Promise<State> =>
  JSON.parse(await readFile(harness.bindingsFile, 'utf8')) as State

/** One group, two workspaces: Test Workspace (primary) and Other Workspace. */
async function multiBoot(options: {
  extraSessions?: string[]
  archived?: string[]
  sessions?: Array<{ threadId: number; workspaceId: string; sessionId: string; title: string; topicTitle: string }>
} = {}): Promise<{ harness: Harness; otherPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-multi-'))
  const workspaceRoot = join(dir, 'workspace')
  const otherPath = join(dir, 'other')
  const registry = new FakeRegistry(WORKSPACE_ID, workspaceRoot)
  const extra = await registry.create(otherPath, 'Other Workspace')
  for (const id of options.extraSessions ?? []) extra.sessionIds.push(id)
  registry.archivedSessionIds.push(...(options.archived ?? []))
  const seeded = makeBindings(workspaceRoot)
  seeded.workspaces[extra.id] = { chatId: CHAT_ID, path: otherPath, title: 'Other Workspace' }
  for (const session of options.sessions ?? []) {
    seeded.sessions[`${CHAT_ID}:${session.threadId}`] = {
      workspaceId: session.workspaceId,
      sessionId: session.sessionId,
      title: session.title,
      topicTitle: session.topicTitle,
    }
  }
  const harness = await start(await boot({ workspaceRoot }, { dir, bindings: seeded, registry }))
  return { harness, otherPath }
}

const createdTopics = (harness: Harness): string[] =>
  harness.calls.filter((call) => call.method === 'createForumTopic').map((call) => String(call.params.name))

describe('a group with several workspaces', () => {
  it('keeps bare topic titles when the group has one workspace', async () => {
    const harness = await start(await boot())
    harness.pushUpdate(harness.makeUpdate({ text: '/new Hello', threadId: 0 }))
    await harness.waitFor(
      () => harness.sent.find((call) => callText(call).includes('started') && callText(call).includes('Hello')),
      'the single-workspace new-session reply',
      6000,
    )
    expect(createdTopics(harness)).toContain('Hello')
    const state = await stateOf(harness)
    const created = Object.values(state.sessions).find((row) => row.title === 'Hello')
    expect(created?.workspaceId).toBe(WORKSPACE_ID)
    expect(created?.topicTitle).toBe('Hello')
  }, 20_000)

  it('syncs every active session in every workspace, with prefixes, and skips archived ones', async () => {
    const { harness, otherPath } = await multiBoot({
      extraSessions: ['sess-other-1', 'sess-archived-1'],
      archived: ['sess-archived-1'],
    })
    harness.registry.attached.push(SESSION_ID)

    harness.pushUpdate(harness.makeUpdate({ text: '/sync', threadId: 0 }))
    const summary = await harness.waitFor(
      () => harness.edited.find((call) => callText(call).includes('across 2 workspace(s)')),
      'the multi-workspace sync summary',
      12_000,
    )
    expect(callText(summary)).toContain('1 archived skipped')
    expect(createdTopics(harness)).toContain('[Other Workspace] session ther-1')
    expect(createdTopics(harness).some((name) => name.includes('archived'))).toBe(false)

    const state = await stateOf(harness)
    const rows = Object.values(state.sessions)
    expect(rows.some((row) => row.sessionId === 'sess-other-1' && row.workspaceId === OTHER_ID)).toBe(true)
    expect(rows.some((row) => row.sessionId === 'sess-archived-1')).toBe(false)
    // The primary topic was already bound; adding the second workspace renamed
    // it to carry the prefix rather than duplicating it.
    expect(createdTopics(harness).filter((name) => name.includes('Test Session'))).toHaveLength(0)
    expect(harness.calls.some((call) => call.method === 'editForumTopic'
      && String(call.params.name) === '[Test Workspace] Test Session')).toBe(true)
    expect(otherPath.length).toBeGreaterThan(0)
  }, 30_000)

  it('creates a new session in the named workspace and routes the first prompt there', async () => {
    const { harness, otherPath } = await multiBoot()
    harness.pushUpdate(harness.makeUpdate({ text: '/new Other Workspace Hello', threadId: 0 }))
    await harness.waitFor(
      () => harness.sent.find((call) => {
        const text = callText(call)
        return text.includes('started') && text.includes('Hello') && text.includes('Other Workspace')
      }),
      'the new-session reply',
      6000,
    )
    expect(createdTopics(harness)).toContain('[Other Workspace] Hello')

    const ready = await harness.waitFor(
      () => harness.sent.find((call) => callText(call).includes('send a message to begin')),
      'the ready message in the new topic',
      6000,
    )
    const threadId = Number(ready.params.message_thread_id)
    harness.pushUpdate(harness.makeUpdate({ text: 'first prompt', threadId }))
    await harness.waitFor(
      () => harness.agents.createRequests.find((request) => String(request.meta?.cwd) === otherPath),
      'the agent created with the other workspace cwd',
      6000,
    )
    const state = await stateOf(harness)
    expect(state.sessions[`${CHAT_ID}:${threadId}`]?.workspaceId).toBe(OTHER_ID)
  }, 20_000)

  it('routes a hand-made prefixed topic even before its first session exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-multi-hand-'))
    const workspaceRoot = join(dir, 'workspace')
    const otherPath = join(dir, 'other')
    const registry = new FakeRegistry(WORKSPACE_ID, workspaceRoot)
    const extra = await registry.create(otherPath, 'Other Workspace')
    const seeded = makeBindings(workspaceRoot)
    seeded.workspaces[extra.id] = { chatId: CHAT_ID, path: otherPath, title: 'Other Workspace' }
    seeded.topicTitles = { [`${CHAT_ID}:9`]: '[Other Workspace] handmade' }
    const harness = await start(await boot({ workspaceRoot }, { dir, bindings: seeded, registry }))

    harness.pushUpdate(harness.makeUpdate({ text: 'hello', threadId: 9 }))
    await harness.waitFor(
      () => harness.agents.createRequests.find((request) => String(request.meta?.cwd) === otherPath),
      'the prefix routed the prompt to Other Workspace',
      6000,
    )
    const state = await stateOf(harness)
    expect(state.sessions[`${CHAT_ID}:9`]).toMatchObject({
      workspaceId: OTHER_ID,
      title: 'handmade',
      topicTitle: '[Other Workspace] handmade',
    })
  }, 20_000)

  it('prefixes existing topics when a second workspace joins the group', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-multi-bind-'))
    const workspaceRoot = join(dir, 'workspace')
    const otherPath = join(dir, 'other')
    const seeded = makeBindings(workspaceRoot)
    seeded.workspaces['ws-other'] = { chatId: 0, path: otherPath, title: 'Other Workspace' }
    const harness = await start(await boot({ workspaceRoot }, { dir, bindings: seeded }))

    harness.pushUpdate(harness.makeUpdate({ text: '/bind Other Workspace', threadId: 0 }))
    await harness.waitFor(
      () => harness.sent.find((call) => callText(call).includes('2 workspaces')),
      'the group dashboard after binding the second workspace',
      6000,
    )
    expect(harness.calls.some((call) => call.method === 'editForumTopic'
      && String(call.params.name) === '[Test Workspace] Test Session')).toBe(true)
    const state = await stateOf(harness)
    expect(state.sessions[`${CHAT_ID}:${THREAD_ID}`]?.topicTitle).toBe('[Test Workspace] Test Session')
    expect(state.workspaces['ws-other']?.chatId).toBe(CHAT_ID)
  }, 20_000)

  it('keeps a session topic inside its workspace when the name is edited by hand', async () => {
    const { harness } = await multiBoot({
      sessions: [{
        threadId: OTHER_THREAD,
        workspaceId: OTHER_ID,
        sessionId: 'sess-other-rename',
        title: 'Other Session',
        topicTitle: '[Other Workspace] Other Session',
      }],
    })
    // Renaming without the prefix is a routing hazard; the connector puts the
    // prefix back and leaves the session title alone.
    harness.pushUpdate(harness.makeUpdate({
      text: undefined,
      threadId: OTHER_THREAD,
      extra: { forum_topic_edited: { name: 'renamed' } },
    }))
    await harness.waitFor(
      () => harness.calls.find((call) => call.method === 'editForumTopic'
        && call.params.message_thread_id === OTHER_THREAD
        && String(call.params.name) === '[Other Workspace] Other Session'),
      'the prefix repaired on the topic',
      6000,
    )
    let state = await stateOf(harness)
    expect(state.sessions[`${CHAT_ID}:${OTHER_THREAD}`]?.title).toBe('Other Session')

    // A rename that carries the right prefix is accepted and stored without it.
    harness.pushUpdate(harness.makeUpdate({
      text: undefined,
      threadId: OTHER_THREAD,
      extra: { forum_topic_edited: { name: '[Other Workspace] Renamed' } },
    }))
    state = await harness.waitFor(async () => {
      const current = await stateOf(harness)
      return current.sessions[`${CHAT_ID}:${OTHER_THREAD}`]?.title === 'Renamed' ? current : false
    }, 'the accepted topic rename', 6000)
    expect(state.sessions[`${CHAT_ID}:${OTHER_THREAD}`]?.topicTitle).toBe('[Other Workspace] Renamed')
  }, 20_000)

  it('detaches one workspace and leaves its sibling topics alone', async () => {
    const { harness } = await multiBoot({
      sessions: [
        {
          threadId: THREAD_ID,
          workspaceId: WORKSPACE_ID,
          sessionId: SESSION_ID,
          title: 'Test Session',
          topicTitle: '[Test Workspace] Test Session',
        },
        {
          threadId: OTHER_THREAD,
          workspaceId: OTHER_ID,
          sessionId: 'sess-other-2',
          title: 'Other Session',
          topicTitle: '[Other Workspace] Other Session',
        },
      ],
    })

    harness.pushUpdate(harness.makeUpdate({ text: '/unbind Other Workspace confirm', threadId: 0 }))
    const reply = await harness.waitFor(
      () => harness.sent.find((call) => callText(call).includes('detached') && callText(call).includes('Other Workspace')),
      'the detach reply',
      6000,
    )
    expect(callText(reply)).toContain('still hosts 1 other workspace(s)')
    expect(harness.calls.some((call) => call.method === 'deleteForumTopic' && call.params.message_thread_id === OTHER_THREAD)).toBe(true)
    expect(harness.calls.some((call) => call.method === 'deleteForumTopic' && call.params.message_thread_id === THREAD_ID)).toBe(false)
    const after = await stateOf(harness)
    expect(after.workspaces[OTHER_ID]).toBeUndefined()
    expect(after.sessions[`${CHAT_ID}:${THREAD_ID}`]?.sessionId).toBe(SESSION_ID)
    // With one workspace left the prefix is no longer required, so the survivor
    // returns to a bare name.
    expect(harness.calls.some((call) => call.method === 'editForumTopic'
      && call.params.message_thread_id === THREAD_ID
      && String(call.params.name) === 'Test Session')).toBe(true)
    expect(after.sessions[`${CHAT_ID}:${THREAD_ID}`]?.topicTitle).toBe('Test Session')
  }, 20_000)
})
