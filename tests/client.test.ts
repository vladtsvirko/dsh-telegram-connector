import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface ClientModule {
  inject: string[]
  apply: (ctx: unknown) => void
}

function loadClient(): ClientModule {
  const code = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  let loaded: ClientModule | undefined
  let hookIndex = 0
  const hookStates: unknown[] = []
  const react = {
    createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }),
    useState: (initial: unknown) => {
      const index = hookIndex++
      if (!(index in hookStates)) hookStates[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
      return [hookStates[index], (value: unknown) => { hookStates[index] = value }]
    },
    useEffect: () => {
      hookIndex++
    },
  }
  const window = {
    __ModuleLoader__: {
      load: ({ factory }: { factory: (require: (name: string) => unknown) => unknown }) => {
        loaded = factory((name) => (name === 'react' ? react : {})) as ClientModule
      },
    },
  }
  const globalWithWindow = globalThis as { window?: unknown }
  const previous = globalWithWindow.window
  globalWithWindow.window = window
  try {
    new Function('window', code)(window)
  } finally {
    globalWithWindow.window = previous
  }
  if (loaded === undefined) throw new Error('the client bundle did not register a factory')
  return loaded
}

describe('telegram config page', () => {
  it('registers the row config slot for the connector row', () => {
    const client = loadClient()
    expect(client.inject).toContain('slots')
    const registrations: Array<{ spec: unknown; component: unknown }> = []
    const ctx = {
      slots: {
        inject: (_name: string, register: () => void) => register(),
        register: (spec: unknown, component: unknown) => {
          registrations.push({ spec, component })
          return () => {}
        },
      },
    }
    client.apply(ctx)
    expect(registrations).toHaveLength(1)
    expect(registrations[0]?.spec).toEqual({ name: 'plugins.row.config', key: 'dsh-telegram-connector#dsh-telegram-connector' })
    expect(typeof registrations[0]?.component).toBe('function')
  })

  it('renders the form with a ready settings snapshot', () => {
    const client = loadClient()
    let component: ((props: unknown) => unknown) | undefined
    const ctx = {
      slots: {
        inject: (_name: string, register: () => void) => register(),
        register: (_spec: unknown, value: (props: unknown) => unknown) => {
          component = value
          return () => {}
        },
      },
    }
    client.apply(ctx)
    const form = {
      state: {
        status: 'ready',
        value: { botToken: '123:token', allowedUserIds: [42], adminUserId: 42 },
        user: { botToken: '123:token' },
        revision: 1,
        writable: true,
      },
      mutate: async () => true,
    }
    const element = component?.({ view: 'page', form }) as { type: (props: unknown) => unknown; props: unknown }
    const tree = element.type(element.props)
    expect(tree).not.toBeNull()
    expect((tree as { type?: string }).type).toBe('div')
  })

  it('renders nothing for the summary view', () => {
    const client = loadClient()
    let component: ((props: unknown) => unknown) | undefined
    const ctx = {
      slots: {
        inject: (_name: string, register: () => void) => register(),
        register: (_spec: unknown, value: (props: unknown) => unknown) => {
          component = value
          return () => {}
        },
      },
    }
    client.apply(ctx)
    expect(component?.({ view: 'summary', form: undefined })).toBeNull()
    expect(component?.({ view: 'page', form: undefined })).not.toBeNull()
  })
})
