/**
 * `/system update` wiring, with the plugin manager faked.
 *
 * The resolver has its own unit tests; this drives the real command handlers
 * through the real connector so argument parsing, admin gating, the remove →
 * install sequence and the messages are exercised together. No supervisor is
 * configured, so these also cover the standalone wording.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { boot, callText, USER_ID, type Harness } from './harness.js'

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

interface FakeBundle {
  name: string
  version: string
  enabled: boolean
  installed: boolean
  source: string
}

function fakeManager(initial: FakeBundle[]) {
  let bundles = initial
  const calls: string[] = []
  const manager = {
    listBundles: () => bundles,
    inspect: async () => ({ status: 'accepted', name: 'x', version: '0.0.0', bundle: true }),
    removeBundle: async (name: string) => {
      calls.push(`remove:${name}`)
      bundles = bundles.filter((bundle) => bundle.name !== name)
      return { changed: true, application: 'applied', bundle: name }
    },
    installBundle: async (spec: string, options?: { enabled?: boolean }) => {
      calls.push(`install:${spec}`)
      const version = /#v(.+)$/.exec(spec)?.[1] ?? '0.0.0'
      bundles = [{
        name: 'dsh-penpot-plugin',
        version,
        enabled: options?.enabled ?? true,
        installed: true,
        source: spec,
      }]
      return { changed: true, application: 'applied', bundle: 'dsh-penpot-plugin', version }
    },
    setBundleEnabled: async () => ({ changed: true, application: 'applied' }),
  }
  return { manager, calls }
}

const penpot = (version = '0.3.0'): FakeBundle => ({
  name: 'dsh-penpot-plugin',
  version,
  enabled: true,
  installed: true,
  source: `github:vladtsvirko/dsh-penpot-plugin#v${version}`,
})

async function start(manager: unknown): Promise<Harness> {
  const harness = await boot(
    { adminUserId: USER_ID, allowedUserIds: [USER_ID] },
    { services: { pluginManager: manager } },
  )
  active.push(harness)
  return harness
}

describe('/system update penpot', () => {
  it('removes the old bundle and installs the requested tag', async () => {
    const fake = fakeManager([penpot()])
    const harness = await start(fake.manager)
    harness.pushUpdate(privateUpdate(harness, '/system update penpot to v0.3.1'))
    const answer = await harness.waitFor(
      () => harness.sent.find((call) => callText(call).includes('updated')),
      'the update confirmation',
      6000,
    )
    expect(callText(answer)).toContain('0.3.1')
    expect(fake.calls).toEqual([
      'remove:dsh-penpot-plugin',
      'install:github:vladtsvirko/dsh-penpot-plugin#v0.3.1',
    ])
  }, 20_000)

  it('reports the installed version as current without touching it', async () => {
    const fake = fakeManager([penpot('0.3.1')])
    const harness = await start(fake.manager)
    harness.pushUpdate(privateUpdate(harness, '/system update penpot to v0.3.1'))
    const answer = await harness.waitFor(
      () => harness.sent.find((call) => callText(call).includes('is current')),
      'the up-to-date answer',
      6000,
    )
    expect(callText(answer)).toContain('0.3.1')
    expect(fake.calls).toEqual([])
  }, 20_000)

  it('accepts the generic plugin form', async () => {
    const fake = fakeManager([penpot()])
    const harness = await start(fake.manager)
    harness.pushUpdate(privateUpdate(harness, '/system update plugin dsh-penpot-plugin to v0.3.1'))
    await harness.waitFor(
      () => harness.sent.find((call) => callText(call).includes('updated')),
      'the generic update confirmation',
      6000,
    )
    expect(fake.calls.at(-1)).toBe('install:github:vladtsvirko/dsh-penpot-plugin#v0.3.1')
  }, 20_000)
})

describe('/system update connector', () => {
  it('explains the host path when there is no supervisor', async () => {
    const fake = fakeManager([penpot()])
    const harness = await start(fake.manager)
    harness.pushUpdate(privateUpdate(harness, '/system update connector'))
    const answer = await harness.waitFor(
      () => harness.sent.find((call) => callText(call).includes('no supervisor')),
      'the standalone explanation',
      6000,
    )
    expect(callText(answer)).toContain('dsh plugin')
    expect(fake.calls).toEqual([])
  }, 20_000)
})
