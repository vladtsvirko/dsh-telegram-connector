/**
 * The trial Commit button must not be gated by Telegram.
 *
 * On a lossy link a toast or a card edit can stall for the client's 60 s
 * timeout. The commit itself is a local supervisor call; this drives a real
 * callback with a fake supervisor and an `answerCallbackQuery` that never
 * answers, and expects the commit to happen anyway.
 */
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { boot, callText, USER_ID, type Harness } from './harness.js'

const active: Harness[] = []
const servers: Server[] = []

afterEach(async () => {
  while (active.length > 0) await active.pop()?.dispose()
  while (servers.length > 0) {
    const server = servers.pop()
    if (server !== undefined) await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

/** A loopback supervisor that knows one trial and records the commit. */
async function fakeSupervisor(armed = true): Promise<{ url: string; committed: () => boolean }> {
  let committed = false
  const trial = { id: 'trial-1', armed, startedAt: Date.now(), deadline: Date.now() + 120_000 }
  const server = createServer((request, response) => {
    const send = (status: number, body: unknown): void => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    }
    if (request.method === 'GET' && request.url === '/status') {
      send(200, { child: 'running', stable: true, trial, lastEvent: null })
      return
    }
    if (request.method === 'POST' && request.url === '/trial/commit') {
      committed = true
      send(200, { ok: true })
      return
    }
    send(404, { error: 'not found' })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { url: `http://127.0.0.1:${String(address.port)}`, committed: () => committed }
}

describe('trial commit', () => {
  it('commits even when the callback toast never answers', async () => {
    const supervisor = await fakeSupervisor()
    // boot() replaces global fetch with the fake Bot API, so keep the real one
    // for the loopback supervisor before that happens.
    const realFetch = globalThis.fetch
    const harness = await boot(
      { adminUserId: USER_ID, allowedUserIds: [USER_ID] },
      { env: { DSH_SUPERVISOR_URL: supervisor.url, DSH_SUPERVISOR_TOKEN: 'test-token' } },
    )
    active.push(harness)

    // Everything else keeps working; only the toast hangs, like a stalled link.
    const telegramFetch = globalThis.fetch
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith(supervisor.url)) return realFetch(input, init)
      if (url.includes('/answerCallbackQuery')) {
        return new Promise<Response>(() => {
          /* never settles */
        })
      }
      return telegramFetch(input, init)
    }) as typeof fetch

    harness.pushUpdate({
      update_id: 9100,
      callback_query: {
        id: 'cb-commit',
        from: { id: USER_ID, is_bot: false, first_name: 'Admin' },
        data: 'trial:commit:trial-1',
      },
    })

    await harness.waitFor(() => supervisor.committed(), 'the supervisor commit', 3000)
    expect(supervisor.committed()).toBe(true)
  }, 20_000)
})

describe('trial feedback', () => {
  it('answers a commit that lands before the runtime is armed', async () => {
    const supervisor = await fakeSupervisor(false)
    const realFetch = globalThis.fetch
    const harness = await boot(
      { adminUserId: USER_ID, allowedUserIds: [USER_ID] },
      { env: { DSH_SUPERVISOR_URL: supervisor.url, DSH_SUPERVISOR_TOKEN: 'test-token' } },
    )
    active.push(harness)
    const telegramFetch = globalThis.fetch
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith(supervisor.url)) return realFetch(input, init)
      return telegramFetch(input, init)
    }) as typeof fetch

    harness.pushUpdate({
      update_id: 9200,
      callback_query: {
        id: 'cb-early',
        from: { id: USER_ID, is_bot: false, first_name: 'Admin' },
        data: 'trial:commit:trial-1',
      },
    })

    const answer = await harness.waitFor(() => harness.answered[0], 'the refusal toast', 3000)
    expect(String(answer.params.text)).toContain('still starting')
    expect(supervisor.committed()).toBe(false)
  }, 20_000)

  it('sends the outcome when the trial card cannot be edited', async () => {
    const supervisor = await fakeSupervisor()
    const realFetch = globalThis.fetch
    const harness = await boot(
      { adminUserId: USER_ID, allowedUserIds: [USER_ID] },
      {
        env: { DSH_SUPERVISOR_URL: supervisor.url, DSH_SUPERVISOR_TOKEN: 'test-token' },
        failSend: (call) => (call.method === 'editMessageText' ? 'Bad Request: message cannot be edited' : undefined),
      },
    )
    active.push(harness)
    const telegramFetch = globalThis.fetch
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith(supervisor.url)) return realFetch(input, init)
      return telegramFetch(input, init)
    }) as typeof fetch

    harness.pushUpdate({
      update_id: 9300,
      callback_query: {
        id: 'cb-feedback',
        from: { id: USER_ID, is_bot: false, first_name: 'Admin' },
        message: { message_id: 777, chat: { id: USER_ID, type: 'private' }, date: 0 },
        data: 'trial:commit:trial-1',
      },
    })

    await harness.waitFor(() => supervisor.committed(), 'the supervisor commit', 3000)
    const notice = await harness.waitFor(
      () => harness.sent.find((call) => callText(call).includes('committed')),
      'the fallback confirmation',
      5000,
    )
    expect(callText(notice)).toContain('committed')
  }, 20_000)
})
