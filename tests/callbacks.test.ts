/**
 * Inline buttons are deployment-wide actions.
 *
 * Trial Commit/Roll back, component Enable/Disable/Port, update Cancel and Take
 * over all change the runtime for every user, exactly like the typed commands
 * that require `adminUserId`. These tests press the buttons as an allowlisted
 * non-admin and as the admin, and assert the gate the typed commands already had.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { boot, callText, CHAT_ID, USER_ID, type Harness } from './harness.js'
import type { TgUpdate } from '../src/telegram.js'

const ADMIN_ID = 777
const active: Harness[] = []
let nextUpdateId = 90_000

afterEach(async () => {
  while (active.length > 0) {
    const harness = active.pop()
    if (harness !== undefined) await harness.dispose()
  }
})

async function start(): Promise<Harness> {
  const harness = await boot({
    allowedUserIds: [USER_ID, ADMIN_ID],
    adminUserId: ADMIN_ID,
  })
  active.push(harness)
  return harness
}

/** Press an inline button as `userId`, in the workspace group. */
function press(harness: Harness, data: string, userId: number): void {
  const update: TgUpdate = {
    update_id: nextUpdateId++,
    callback_query: {
      id: `cb-${data}-${String(userId)}`,
      from: { id: userId, is_bot: false, first_name: 'Tester' },
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: CHAT_ID, type: 'supergroup' },
      },
      chat_instance: 'test',
      data,
    },
  }
  harness.pushUpdate(update)
}

const answers = (harness: Harness): string[] => harness.answered.map(callText)

describe('callback buttons require the admin account', () => {
  it('refuses Take over from an allowlisted non-admin', async () => {
    const harness = await start()
    press(harness, 'own:take', USER_ID)
    await harness.waitFor(() => answers(harness).includes('only the admin can do that'), 'refusal')
    expect(answers(harness)).not.toContain('restarting…')
  })

  it('refuses trial Commit from an allowlisted non-admin', async () => {
    const harness = await start()
    press(harness, 'trial:commit:trial-1', USER_ID)
    await harness.waitFor(() => answers(harness).includes('only the admin can do that'), 'refusal')
  })

  it('refuses the update card’s ✖ from an allowlisted non-admin', async () => {
    const harness = await start()
    press(harness, 'upd:cancel:update-1', USER_ID)
    await harness.waitFor(() => answers(harness).includes('only the admin can do that'), 'refusal')
  })

  it('refuses deployment buttons from an allowlisted non-admin', async () => {
    const harness = await start()
    press(harness, 'dash:update', USER_ID)
    await harness.waitFor(() => answers(harness).includes('only the admin can do that'), 'refusal')
  })

  it('runs a workspace button for an allowlisted user', async () => {
    const harness = await start()
    press(harness, 'dash:status', USER_ID)
    await harness.waitFor(
      () => harness.sent.find((call) => callText(call).includes('Test Workspace')),
      'dashboard status',
    )
  })

  it('asks before taking over, and names the cost', async () => {
    const harness = await start()
    press(harness, 'own:take', ADMIN_ID)
    await harness.waitFor(() => answers(harness).includes('confirmation required'), 'confirmation')
    const card = await harness.waitFor(
      () => harness.sent.find((call) => callText(call).includes('take over this session')),
      'confirmation card',
    )
    expect(callText(card)).toContain('interrupts <b>every</b> running session')
    expect(JSON.stringify(card.params.reply_markup)).toContain('own:take:confirm')
    expect(JSON.stringify(card.params.reply_markup)).toContain('own:take:cancel')
  })

  it('cancels take-over without restarting', async () => {
    const harness = await start()
    press(harness, 'own:take:cancel', ADMIN_ID)
    await harness.waitFor(() => answers(harness).includes('cancelled'), 'cancelled')
    expect(answers(harness)).not.toContain('restarting…')
  })

  it('lets the admin confirm take-over, reaching the supervisor path', async () => {
    const harness = await start()
    press(harness, 'own:take:confirm', ADMIN_ID)
    await harness.waitFor(
      () => answers(harness).some((text) => text === 'no supervisor here — restart the runtime from the host'),
      'handler reached',
    )
  })

  it('lets the admin through to the real handler', async () => {
    const harness = await start()
    // No supervisor in the harness, so the handler's own refusal is the proof
    // that the permission gate was passed.
    press(harness, 'trial:commit:trial-1', ADMIN_ID)
    await harness.waitFor(
      () => answers(harness).some((text) => text === 'no supervisor is configured'),
      'handler reached',
    )
  })
})

describe('dashboard status and sessions are distinct', () => {
  it('Status summarises the runtime, Sessions lists the workspace', async () => {
    const harness = await start()
    press(harness, 'dash:status', USER_ID)
    const status = await harness.waitFor(
      () => harness.sent.find((call) => callText(call).includes('— status')),
      'status summary',
    )
    expect(callText(status)).toContain('model route')
    expect(callText(status)).not.toContain('path:')

    press(harness, 'dash:sessions', USER_ID)
    const sessions = await harness.waitFor(
      () => harness.sent.find((call) => callText(call).includes('path:')),
      'session list',
    )
    expect(callText(sessions)).toContain('Test Workspace')
  })
})

describe('consequential actions use one confirmation card', () => {
  it('previews /unbind, refuses a non-admin, then executes for the admin with feedback', async () => {
    const harness = await start()
    harness.pushUpdate(harness.makeUpdate({ text: '/unbind', threadId: 0, userId: ADMIN_ID }))
    const card = await harness.waitFor(
      () => harness.sent.find((call) => {
        const markup = call.params.reply_markup as
          | { inline_keyboard?: Array<Array<{ callback_data?: string }>> }
          | undefined
        return markup?.inline_keyboard?.[0]?.[0]?.callback_data?.startsWith('cfm:') === true
      }),
      'the unbind confirmation card',
      6000,
    )
    const markup = card.params.reply_markup as {
      inline_keyboard: Array<Array<{ callback_data: string }>>
    }
    const confirm = markup.inline_keyboard[0]![0]!.callback_data
    expect(callText(card)).toContain('session topic')
    expect(callText(card)).toContain('will be deleted')

    press(harness, confirm, USER_ID)
    await harness.waitFor(() => answers(harness).includes('that confirmation belongs to someone else'), 'non-admin refusal')

    press(harness, confirm, ADMIN_ID)
    await harness.waitFor(
      () => harness.edited.some((call) => callText(call).includes('detached')),
      'the executed result',
      6000,
    )
    expect(harness.answered.map(callText)).toContain('working…')
  })
})
