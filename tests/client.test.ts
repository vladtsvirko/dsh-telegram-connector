import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface ClientModule {
  inject: string[]
  apply: (ctx: unknown) => void
}

function loadClient(): ClientModule {
  const code = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  let loaded: ClientModule | undefined
  const react = { createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }) }
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
