import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { boot, callText, CHAT_ID, makeBindings, THREAD_ID, USER_ID, type Harness } from './harness.js'
import type { TgUpdate } from '../src/telegram.js'

const active: Harness[] = []
const dirs: string[] = []

afterEach(async () => {
  while (active.length > 0) await active.pop()?.dispose()
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  }
})

function messageUpdate(updateId: number, text: string): TgUpdate {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: CHAT_ID, type: 'supergroup', title: 'Test Workspace' },
      from: { id: USER_ID, is_bot: false, first_name: 'Tester' },
      message_thread_id: THREAD_ID,
      text,
    },
  }
}

describe('the first batch after a setup update', () => {
  it('delivers a plain prompt and refuses a command', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stale-batch-'))
    dirs.push(dir)
    const workspaceRoot = join(dir, 'workspace')
    const bindings = makeBindings(workspaceRoot)
    bindings.update = {
      id: 'update-1',
      startedAt: Date.now(),
      mode: 'compatible',
      phase: 'accepted',
      from: 'v0.0.0',
      target: 'v0.0.1',
      chatId: CHAT_ID,
    }
    const harness = await boot(
      { allowedUserIds: [USER_ID], adminUserId: USER_ID, workspaceRoot },
      {
        dir,
        bindings,
        updates: [
          messageUpdate(1, 'a prompt sent while the update restarted'),
          messageUpdate(2, '/status'),
        ],
      },
    )
    active.push(harness)

    await harness.waitFor(
      () => harness.agents.list().some((agent) => agent.followups.some((f) => JSON.stringify(f.content).includes('a prompt sent while the update restarted'))),
      'the plain prompt is delivered',
    )
    const notice = await harness.waitFor(
      () => harness.sent.find((call) => callText(call).includes('commands sent while it restarted')),
      'the command is refused',
    )
    expect(callText(notice)).toContain('send it again')
    expect(
      harness.agents.list().some((agent) => agent.followups.some((f) => JSON.stringify(f.content).includes('/status'))),
    ).toBe(false)
  })
})
