import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  bindingsPath,
  findWorkspace,
  loadBindings,
  removeSession,
  saveBindings,
  sessionFor,
  sessionKey,
  sessionsOfChat,
  setSession,
  workspaceByChat,
  workspaceIdByChat,
} from '../src/bindings.js'

const temp = (): Promise<string> => mkdtemp(join(tmpdir(), 'connector-'))

describe('bindings v2', () => {
  it('loads empty bindings when the file is missing', async () => {
    const bindings = await loadBindings(bindingsPath(await temp()))
    expect(bindings.version).toBe(2)
    expect(bindings.workspaces).toEqual({})
    expect(bindings.sessions).toEqual({})
  })

  it('ignores a v1 file instead of misreading it', async () => {
    const dir = await temp()
    const file = bindingsPath(dir)
    await saveBindings(file, { version: 2, workspaces: {}, sessions: {} })
    expect((await loadBindings(file)).version).toBe(2)
  })

  it('round-trips workspaces and sessions', async () => {
    const dir = await temp()
    const file = bindingsPath(dir)
    const bindings = await loadBindings(file)

    bindings.controlChatId = 42
    bindings.trialMessage = { chatId: -100, messageId: 7, trialId: 't1' }
    bindings.timezone = 'Europe/Minsk'
    bindings.reactions = { enabled: true, read: '👀', streaming: '✍', staged: '🙉' }
    bindings.workspaces['ws-1'] = { chatId: -100, path: '/srv/one', title: 'one' }
    setSession(bindings, -100, 7, { workspaceId: 'ws-1', sessionId: 'session-a' })
    await saveBindings(file, bindings)

    const again = await loadBindings(file)
    expect(again.controlChatId).toBe(42)
    expect(again.trialMessage).toEqual({ chatId: -100, messageId: 7, trialId: 't1' })
    expect(again.timezone).toBe('Europe/Minsk')
    expect(again.reactions).toEqual({ enabled: true, read: '👀', streaming: '✍', staged: '🙉' })
    expect(workspaceByChat(again, -100)?.title).toBe('one')
    expect(workspaceIdByChat(again, -100)).toBe('ws-1')
    expect(sessionFor(again, -100, 7)?.sessionId).toBe('session-a')
    expect(JSON.parse(await readFile(file, 'utf8')).version).toBe(2)
  })

  it('finds a workspace by id, prefix, title or path basename', async () => {
    const bindings = await loadBindings(bindingsPath(await temp()))
    bindings.workspaces['9cb88d9f-f62d'] = { chatId: -100, path: '/srv/workspaces/web-app', title: 'Web App' }

    expect(findWorkspace(bindings, '9cb88d9f')?.[0]).toBe('9cb88d9f-f62d')
    expect(findWorkspace(bindings, 'web app')?.[0]).toBe('9cb88d9f-f62d')
    expect(findWorkspace(bindings, '/srv/workspaces/web-app')?.[0]).toBe('9cb88d9f-f62d')
    expect(findWorkspace(bindings, 'web-app')?.[0]).toBe('9cb88d9f-f62d')
    expect(findWorkspace(bindings, 'nope')).toBeUndefined()
  })

  it('lists a group’s sessions and removes one', async () => {
    const bindings = await loadBindings(bindingsPath(await temp()))
    setSession(bindings, -100, 1, { workspaceId: 'ws', sessionId: 'session-1' })
    setSession(bindings, -100, 2, { workspaceId: 'ws', sessionId: 'session-2' })
    setSession(bindings, -200, 3, { workspaceId: 'ws2', sessionId: 'session-3' })

    expect(sessionsOfChat(bindings, -100).map(([thread]) => thread)).toEqual([1, 2])
    removeSession(bindings, -100, 1)
    expect(sessionFor(bindings, -100, 1)).toBeUndefined()
    expect(sessionsOfChat(bindings, -100)).toHaveLength(1)
    expect(sessionKey(-100, 2)).toBe('-100:2')
  })
})
