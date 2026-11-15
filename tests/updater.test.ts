/**
 * The stable updater: remove + install through the plugin manager, open the
 * supervisor trial, and post one Commit/Roll back card for non-connector
 * targets. The connector itself is announced by the reloaded connector, so
 * `announce: false` must not duplicate the card.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { apply } from '../updater/index.js'

const originalFetch = globalThis.fetch
const originalEnv = { ...process.env }

afterEach(() => {
  globalThis.fetch = originalFetch
  process.env = { ...originalEnv }
})

interface Call {
  url: string
  body: Record<string, unknown> | undefined
}

function setup(options: { removeApplication?: string; installApplication?: string } = {}) {
  const calls: Call[] = []
  const managers: { removed: string[]; installed: Array<{ spec: string; options: unknown }> } = { removed: [], installed: [] }
  const services = new Map<string, unknown>()
  let service: { update: (request: unknown) => boolean } | undefined
  const ctx = {
    get: (name: string) => services.get(name),
    provide: (name: string, value: unknown) => {
      services.set(name, value)
      service = value as typeof service
    },
  }
  services.set('pluginManager', {
    removeBundle: async (name: string) => {
      managers.removed.push(name)
      return { application: options.removeApplication ?? 'applied' }
    },
    installBundle: async (spec: string, installOptions: unknown) => {
      managers.installed.push({ spec, options: installOptions })
      return { application: options.installApplication ?? 'applied' }
    },
  })
  process.env.DSH_SUPERVISOR_URL = 'http://supervisor.test'
  process.env.DSH_SUPERVISOR_TOKEN = 'token'
  process.env.DSH_TELEGRAM_BOT_TOKEN = '123:fake'
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined
    calls.push({ url, body })
    if (url.endsWith('/trial/open')) {
      return new Response(JSON.stringify({ ok: true, trial: { id: 'trial-9', deadline: Date.now() + 120_000 } }), { status: 200 })
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }) as typeof fetch
  apply(ctx as never)
  return { calls, managers, service: service as NonNullable<typeof service> }
}

const waitFor = async (predicate: () => boolean, label: string): Promise<void> => {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${label}`)
}

describe('the stable updater', () => {
  it('reloads a target and posts one commit card', async () => {
    const { calls, managers, service } = setup()
    expect(service.update({ name: 'other-plugin', spec: 'other-plugin@2.0.0', chatId: 42, label: 'other-plugin 1 → 2', announce: true })).toBe(true)
    await waitFor(() => managers.installed.length === 1 && calls.some((call) => call.url.includes('/sendMessage') && String(call.body?.text ?? '').includes('updated')), 'the card')
    expect(managers.removed).toEqual(['other-plugin'])
    expect(managers.installed[0]?.spec).toBe('other-plugin@2.0.0')
    const card = calls.find((call) => call.url.includes('/sendMessage') && String(call.body?.text ?? '').includes('updated'))
    expect(String(card?.body?.text)).toContain('other-plugin 1 → 2')
    const markup = card?.body?.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> }
    expect(markup.inline_keyboard[0]?.[0]?.callback_data).toBe('trial:commit:trial-9')
    expect(markup.inline_keyboard[0]?.[1]?.callback_data).toBe('trial:rollback:trial-9')
    expect(calls.some((call) => call.url.endsWith('/trial/open'))).toBe(true)
  })

  it('does not duplicate the card for a connector self-update', async () => {
    const { calls, managers, service } = setup()
    expect(service.update({ name: 'dsh-telegram-connector', spec: 'dsh-telegram-connector@9.9.9', chatId: 42, label: 'the connector', announce: false })).toBe(true)
    await waitFor(() => managers.installed.length === 1, 'the install')
    expect(calls.some((call) => call.url.includes('/sendMessage') && String(call.body?.text ?? '').includes('updated'))).toBe(false)
  })

  it('installs after a restart-required remove and restarts without a target ref', async () => {
    const { calls, managers, service } = setup({ removeApplication: 'restart-required' })
    expect(service.update({ name: 'other-plugin', spec: 'other-plugin@2.0.0', chatId: 42, label: 'other', announce: true })).toBe(true)
    await waitFor(() => calls.some((call) => call.url.endsWith('/update')), 'the supervisor update')
    expect(managers.installed[0]?.spec).toBe('other-plugin@2.0.0')
    const fallback = calls.find((call) => call.url.endsWith('/update'))
    // The target is not the connector: never pass it as the connector ref.
    expect(fallback?.body).toEqual({ trial: true })
    expect(calls.some((call) => call.url.endsWith('/trial/abandon'))).toBe(true)
  })

  it('aborts a failed remove without restarting the runtime', async () => {
    const { calls, managers, service } = setup({ removeApplication: 'failed' })
    expect(service.update({ name: 'other-plugin', spec: 'other-plugin@2.0.0', chatId: 42, label: 'other', announce: true })).toBe(true)
    await waitFor(() => calls.some((call) => call.url.endsWith('/trial/abandon')), 'the abandon')
    expect(managers.installed).toEqual([])
    expect(calls.some((call) => call.url.endsWith('/update'))).toBe(false)
  })
})
