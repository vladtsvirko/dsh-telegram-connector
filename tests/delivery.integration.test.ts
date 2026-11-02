/**
 * End-to-end delivery tests for `src/index.ts`.
 *
 * These are the tests the connector was missing: every existing test covers a
 * helper module, while these boot the real `apply()` and observe what actually
 * reaches the fake Telegram Bot API.
 *
 * The harness (and why bindings are seeded from disk) is documented in
 * `tests/harness.ts`.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  boot,
  callText,
  CHAT_ID,
  SESSION_ID,
  THREAD_ID,
  type FakeAgent,
  type Harness,
} from './harness.js'

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

/** A DSH `user/message` event, as the connector receives it. */
function userMessage(text: string, kind = 'user'): { type: string; data: unknown } {
  return {
    type: 'user/message',
    data: { content: [{ type: 'text', text }], source: { kind } },
  }
}

function assistantMessage(text: string): { type: string; data: unknown } {
  return {
    type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text }] } },
  }
}

function turnStart(): { type: string; data: unknown } {
  return { type: 'turn/start', data: {} }
}

function turnEnd(): { type: string; data: unknown } {
  return { type: 'turn/end', data: {} }
}

/** Drive one complete Telegram turn so the topic has a prior streamed message. */
async function priorTelegramTurn(harness: Harness, prompt: string, answer: string): Promise<FakeAgent> {
  harness.pushUpdate(harness.makeUpdate({ text: prompt }))
  const agent = await harness.waitFor(() => harness.agents.created[0], 'agent created')
  await harness.waitFor(() => agent.followups.length === 1, 'Telegram prompt reached the agent')

  harness.emitSessionEvent(agent.session, turnStart())
  // The plugin recorded this prompt in `injected`; DSH echoes it as user/message.
  harness.emitSessionEvent(agent.session, userMessage(prompt))
  harness.emitSessionEvent(agent.session, assistantMessage(answer))
  await harness.waitFor(
    () => harness.sent.some((call) => callText(call).includes(answer)),
    'prior Telegram answer sent',
  )
  harness.emitSessionEvent(agent.session, turnEnd())
  // turn/end settles the stream and the process view asynchronously.
  await new Promise((resolve) => setTimeout(resolve, 50))
  return agent
}

describe('web UI mirror', () => {
  it('posts the echo and then the answer as a new message, not an edit of the previous turn', async () => {
    // The topic was created from Telegram and has already streamed one answer.
    // Then a web UI tab takes the session: the plugin learns this from the first
    // foreign `user/message` and releases its agent. That leaves the old sink
    // (buffer + message ids) in place, which is exactly where the bug lived.
    const harness = await start(await boot())
    const agent = await priorTelegramTurn(harness, 'telegram prompt', 'old answer')
    const oldAnswer = harness.sent.find((call) => callText(call).includes('old answer'))
    expect(oldAnswer).toBeDefined()

    // A prompt typed in the web UI. Real DSH order is turn/start, user/message,
    // assistant/message, turn/end.
    const webSession = agent.session
    harness.emitSessionEvent(webSession, turnStart())
    harness.emitSessionEvent(webSession, userMessage('web prompt'))
    expect(agent.disposed).toBe(true) // the plugin released its stale handle

    harness.emitSessionEvent(webSession, assistantMessage('web answer'))
    harness.emitSessionEvent(webSession, turnEnd())

    const echo = await harness.waitFor(
      () => harness.sent.find((call) => callText(call).includes('you (web)')),
      'web prompt echo',
      6000,
    )
    // BUG (pre-fix 3f90313): this waitFor timed out. The mirror branch of
    // `session/event` (src/index.ts:4701 at that revision) handled turn/end,
    // user/message and assistant/message but not turn/start, so it never reset
    // the sink. `mirror(..., false)` appended the answer to the previous
    // Telegram turn's buffer (src/index.ts:4677), and `flushNow()` then read
    // the stale `runtime.parts[0]` at src/index.ts:2271 and took the edit
    // branch at src/index.ts:2283 instead of sendStreamChunk(). The echo
    // appeared; the answer did not.
    const answer = await harness.waitFor(
      () => harness.sent.find((call) => callText(call).includes('web answer')),
      'web answer sent as its own message',
      6000,
    )

    expect(callText(echo)).toContain('web prompt')
    expect(echo.params.chat_id).toBe(CHAT_ID)
    expect(echo.params.message_thread_id).toBe(THREAD_ID)
    expect(callText(answer)).not.toContain('you (web)')
    expect(answer.params.chat_id).toBe(CHAT_ID)
    expect(answer.params.message_thread_id).toBe(THREAD_ID)
    // The answer must be a new message after the echo, not the prior turn's
    // message edited in place.
    expect(answer.messageId).toBeGreaterThan(echo.messageId!)
    expect(answer.messageId).toBeGreaterThan(oldAnswer!.messageId!)
    expect(callText(answer)).not.toContain('old answer')
    // And the old message was not repurposed as the web answer.
    const oldEdits = harness.edited.filter((call) => call.params.message_id === oldAnswer!.messageId)
    expect(oldEdits.every((call) => !callText(call).includes('web answer'))).toBe(true)
  }, 20_000)

  // Kept as a marker for the historical failure; the test above now asserts the
  // desired behaviour directly. Before the fix this was a real failure, not a
  // hypothetical: see `review/harness.md` for the exact assertion output.
  it.todo('mirror delivers the assistant answer as a new message after the echo')
})

describe('Telegram-driven turn', () => {
  it('injects the prompt and streams the answer into the right topic with a process card', async () => {
    const harness = await start(await boot())

    harness.pushUpdate(harness.makeUpdate({ text: 'hello from telegram' }))
    const agent = await harness.waitFor(() => harness.agents.created[0], 'agent created')
    await harness.waitFor(() => agent.followups.length === 1, 'prompt reached the agent')

    // 1. The prompt reached the session through the fake agents service.
    expect(agent.session.id).toBe(SESSION_ID)
    expect(agent.followups[0]?.content).toEqual([{ type: 'text', text: 'hello from telegram' }])
    expect(agent.followups[0]?.source?.kind).toBe('user')
    expect(harness.registry.attached).toContain(SESSION_ID)

    // 2. The assistant streams in chunks: first sent, then edited in place.
    harness.emitSessionEvent(agent.session, turnStart())
    harness.emitSessionEvent(agent.session, assistantMessage('Streaming '))
    const first = await harness.waitFor(
      () => harness.sent.find((call) => callText(call).includes('Streaming')),
      'first streamed chunk sent',
      6000,
    )
    expect(first.params.chat_id).toBe(CHAT_ID)
    expect(first.params.message_thread_id).toBe(THREAD_ID)

    // 3. A tool call produces the live process card in the same topic.
    harness.emitSessionEvent(agent.session, {
      type: 'tool/call',
      data: { callId: 'call-1', name: 'read', arguments: JSON.stringify({ path: 'README.md' }) },
    })
    harness.emitSessionEvent(agent.session, assistantMessage('answer'))
    const edit = await harness.waitFor(
      () => harness.edited.find(
        (call) => call.params.message_id === first.messageId
          && callText(call).includes('Streaming')
          && callText(call).includes('answer'),
      ),
      'streamed answer edited in place',
      6000,
    )
    expect(edit.params.chat_id).toBe(CHAT_ID)

    const card = await harness.waitFor(
      () => harness.sent.find(
        (call) => callText(call).includes('Working')
          && call.params.chat_id === CHAT_ID
          && call.params.message_thread_id === THREAD_ID,
      ),
      'process card sent',
      6000,
    )
    expect(callText(card)).toContain('Read: README.md')

    harness.emitSessionEvent(agent.session, {
      type: 'tool/result',
      data: { message: { toolCallId: 'call-1', isError: false } },
    })
    harness.emitSessionEvent(agent.session, turnEnd())

    // 4. turn/end finalises the card as a collapsed summary, still in the topic.
    await harness.waitFor(
      () => harness.edited.find(
        (call) => call.params.message_id === card.messageId
          && callText(call).includes('<details>'),
      ),
      'process card finalised',
      8000,
    )

    // A Telegram prompt is not echoed back as "you (web)".
    expect(harness.sent.some((call) => callText(call).includes('you (web)'))).toBe(false)
  }, 20_000)
})

describe('ownership refusal', () => {
  it('tells the user a held session in plain language and still mirrors later web turns', async () => {
    const harness = await start(await boot({}, {
      agent: {
        failCreateWith: new Error('session is already owned by an active write handle'),
      },
    }))

    harness.pushUpdate(harness.makeUpdate({ text: 'telegram prompt while the web tab is open' }))
    const refusal = await harness.waitFor(
      () => harness.sent.find(
        (call) => call.method === 'sendMessage'
          && call.params.chat_id === CHAT_ID
          && callText(call).includes('held by another client'),
      ),
      'ownership refusal posted',
    )

    const text = callText(refusal)
    // Human-readable recovery advice, not the runtime's raw error or a stack.
    expect(text).toContain('web UI tab')
    expect(text).toContain('queued')
    expect(text).not.toContain('active write handle')
    expect(text).not.toContain('Error:')
    expect(text).not.toMatch(/\n\s+at\s/)
    expect(text.startsWith('⚠️')).toBe(false) // not the generic "⚠️ <raw error>" path
    expect(refusal.params.reply_markup).toEqual({
      inline_keyboard: [[{ text: '↪️ Take over', callback_data: 'own:take' }]],
    })

    // The refused attempt must not leave a runtime that claims the topic: a
    // later web prompt still mirrors, echo first and answer second.
    const webSession = { id: SESSION_ID }
    harness.emitSessionEvent(webSession, turnStart())
    harness.emitSessionEvent(webSession, userMessage('web prompt after refusal'))
    harness.emitSessionEvent(webSession, assistantMessage('web answer after refusal'))
    harness.emitSessionEvent(webSession, turnEnd())

    const echo = await harness.waitFor(
      () => harness.sent.find((call) => callText(call).includes('you (web)')),
      'echo after refusal',
      6000,
    )
    const answer = await harness.waitFor(
      () => harness.sent.find((call) => callText(call).includes('web answer after refusal')),
      'answer after refusal',
      6000,
    )
    expect(answer.messageId).toBeGreaterThan(echo.messageId!)
  }, 20_000)
})

describe('mirrored turns are journaled', () => {
  it('keeps the answer in the bridge when Telegram refuses the send', async () => {
    // Every send to the group is refused: the echo cannot be delivered either,
    // so the sink never gets a message id and the turn stays pending. That is
    // exactly the state a restart would otherwise lose.
    const harness = await start(await boot({}, {
      failSend: (call) => (call.method === 'sendMessage' || call.method === 'sendRichMessage'
        ? 'Bad Request: chat not found'
        : undefined),
    }))
    // No runtime holds this session: the topic mirrors it, which is the path
    // that has to journal the turn.
    const session = { id: SESSION_ID }
    harness.emitSessionEvent(session, turnStart())
    harness.emitSessionEvent(session, userMessage('web prompt'))
    harness.emitSessionEvent(session, assistantMessage('undeliverable answer'))
    await new Promise((resolve) => setTimeout(resolve, 300))
    harness.emitSessionEvent(session, turnEnd())

    const out = join(harness.dir, 'telegram-connector', 'bridge', 'out')
    const files = await harness.waitFor(async () => {
      const names = await readdir(out).catch(() => [] as string[])
      return names.filter((name) => name.endsWith('.json')).length > 0 ? names : false
    }, 'the mirrored turn to be journaled', 6000)
    const record = JSON.parse(await readFile(join(out, files[0]!), 'utf8')) as {
      sessionId: string
      assistant: string
      user?: string
    }
    expect(record.sessionId).toBe(SESSION_ID)
    expect(record.assistant).toContain('undeliverable answer')
    expect(record.user).toBe('web prompt')
  }, 20_000)
})
