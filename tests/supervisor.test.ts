import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { SupervisorClient, SupervisorError, deadlineText, parseTrialCallback, trialCallbackData } from '../src/supervisor.js'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

async function stub(
  handler: (request: { method?: string; url?: string; authorization?: string; body: string }) => { code: number; json: unknown },
): Promise<{ client: SupervisorClient; calls: { method?: string; url?: string; authorization?: string; body: string }[] }> {
  const calls: { method?: string; url?: string; authorization?: string; body: string }[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const call = {
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body: Buffer.concat(chunks).toString('utf8'),
      }
      calls.push(call)
      const result = handler(call)
      const body = JSON.stringify(result.json)
      response.writeHead(result.code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
      response.end(body)
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { client: new SupervisorClient(`http://127.0.0.1:${address.port}`, 'secret'), calls }
}

describe('supervisor client', () => {
  it('reads status with the bearer token', async () => {
    const { client, calls } = await stub(() => ({
      code: 200,
      json: { child: 'running', stable: true, trial: null, trialSeconds: 1800 },
    }))
    const status = await client.status()
    expect(status.child).toBe('running')
    expect(calls[0]?.authorization).toBe('Bearer secret')
    expect(calls[0]?.method).toBe('GET')
    expect(calls[0]?.url).toBe('/status')
  })

  it('starts a trial and arms it', async () => {
    const { client, calls } = await stub((call) => {
      if (call.url === '/restart') return { code: 200, json: { ok: true } }
      return { code: 200, json: { ok: true, firstArm: true, trialId: 't1', deadline: 1_800_000 } }
    })
    await client.restart(true)
    const armed = await client.arm()
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ trial: true })
    expect(armed.deadline).toBe(1_800_000)
    expect(calls[1]?.url).toBe('/trial/arm')
  })

  it('asks the supervisor to update the connector', async () => {
    const { client, calls } = await stub(() => ({ code: 200, json: { ok: true } }))
    await client.update()
    expect(calls[0]?.url).toBe('/update')
    expect(calls[0]?.method).toBe('POST')
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ trial: true })
    await client.update(false)
    expect(JSON.parse(calls[1]?.body ?? '{}')).toEqual({ trial: false })
  })

  it('opens a live trial and can abandon it', async () => {
    const { client, calls } = await stub((call) => {
      if (call.url === '/trial/open') {
        return { code: 200, json: { ok: true, trial: { id: 't2', armed: true, startedAt: 1, deadline: 2 } } }
      }
      return { code: 200, json: { ok: true } }
    })
    const opened = await client.openTrial()
    expect(opened.trial?.id).toBe('t2')
    await client.abandonTrial()
    expect(calls[0]?.url).toBe('/trial/open')
    expect(calls[1]?.url).toBe('/trial/abandon')
  })

  it('surfaces the supervisor’s refusal', async () => {
    const { client } = await stub(() => ({ code: 409, json: { error: 'no trial is running' } }))
    await expect(client.commit()).rejects.toBeInstanceOf(SupervisorError)
    await expect(client.commit()).rejects.toThrow('no trial is running')
  })

  it('round-trips the trial callback payload', () => {
    const data = trialCallbackData('commit', '0b6f-1')
    expect(parseTrialCallback(data)).toEqual({ action: 'commit', trialId: '0b6f-1' })
    expect(parseTrialCallback(trialCallbackData('rollback', 'x'))).toEqual({ action: 'rollback', trialId: 'x' })
    expect(parseTrialCallback('trial:nope:x')).toBeUndefined()
    expect(parseTrialCallback('trial:commit')).toBeUndefined()
    expect(parseTrialCallback(undefined)).toBeUndefined()
  })

  it('formats the deadline as Telegram-native time with a readable fallback', () => {
    const now = Date.UTC(2026, 9, 27, 12, 0, 0)
    const unix = Math.floor((now + 30 * 60_000) / 1000)
    const text = deadlineText(now + 30 * 60_000, now)
    expect(text).toBe(
      `<tg-time unix="${unix}" format="r">in 30 min</tg-time> (at <tg-time unix="${unix}" format="t">12:30 UTC</tg-time>)`,
    )
  })
})
