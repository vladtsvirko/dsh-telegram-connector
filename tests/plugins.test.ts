import { describe, expect, it } from 'vitest'
import {
  describeBundle,
  describeBundleList,
  describeChange,
  describeInspection,
  localized,
  type BundleInfo,
} from '../src/plugins.js'

const bundle = (overrides: Partial<BundleInfo> & { name: string }): BundleInfo => ({
  enabled: false,
  installed: false,
  ...overrides,
})

describe('plugin rendering', () => {
  it('reads a localized title, preferring English', () => {
    expect(localized('  plain  ')).toBe('plain')
    expect(localized({ en: 'English', ru: 'Русский' })).toBe('English')
    expect(localized({ ru: 'Русский' })).toBe('Русский')
    expect(localized({})).toBeUndefined()
    expect(localized('   ')).toBeUndefined()
  })

  it('groups bundles by what can be done with them', () => {
    const text = describeBundleList([
      bundle({ name: 'b-enabled', enabled: true, installed: true, version: '1.0.0' }),
      bundle({ name: 'a-disabled', enabled: false, installed: true, version: '2.0.0' }),
      bundle({ name: 'c-available', availability: 'missing', optional: true }),
      bundle({ name: 'd-broken', enabled: true, installed: true, error: { code: 'not-bundle' } }),
    ])

    expect(text).toContain('2 enabled')
    expect(text).toContain('1 disabled')
    expect(text).toContain('1 available')
    expect(text).toContain('✓ `b-enabled` 1.0.0')
    expect(text).toContain('· `a-disabled` 2.0.0')
    expect(text).toContain('+ `c-available` — optional')
    expect(text).toContain('d-broken` — ⚠️ not-bundle')
    expect(text).toContain('/plugin add <spec>')
    // within a section the order is alphabetical, not input order
    expect(text.indexOf('b-enabled')).toBeLessThan(text.indexOf('d-broken'))
  })

  it('caps a long list and says how much is left', () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      bundle({ name: `p-${String(index).padStart(2, '0')}`, enabled: true, installed: true }))
    const text = describeBundleList(many)
    expect(text).toContain('… and 20 more')
    expect(text).not.toContain('p-59')
  })

  it('describes one bundle with its rows, source and install spec', () => {
    const text = describeBundle(
      bundle({
        name: 'dsh-telegram-connector',
        version: '0.1.0',
        enabled: true,
        installed: true,
        source: 'github:vladtsvirko/dsh-telegram-connector',
        description: 'Telegram control plane for DSH',
        rows: [{ rowId: 'telegram', moduleName: 'dsh-telegram-connector' }],
      }),
    )
    expect(text).toContain('`dsh-telegram-connector` 0.1.0')
    expect(text).toContain('Telegram control plane for DSH')
    expect(text).toContain('enabled · installed')
    expect(text).toContain('source: `github:vladtsvirko/dsh-telegram-connector`')
    expect(text).toContain('rows: `telegram`')
  })

  it('offers the install spec of an available bundle', () => {
    const text = describeBundle(
      bundle({
        name: '@deepseek-ai/dsh-agent-team',
        availability: 'missing',
        official: true,
        installTarget: { spec: '@deepseek-ai/dsh-agent-team@0.2.1-rc.2', version: '0.2.1-rc.2' },
      }),
    )
    expect(text).toContain('/plugin add @deepseek-ai/dsh-agent-team@0.2.1-rc.2')
  })

  it('explains a refused inspection', () => {
    const text = describeInspection({
      status: 'refused',
      problem: 'already-installed',
      reason: 'already installed',
      registries: ['https://registry.npmjs.org/', null],
    })
    expect(text).toContain('cannot install')
    expect(text).toContain('already installed')
    expect(text).toContain('registries asked: `https://registry.npmjs.org/`, pnpm default')
  })

  it('summarises an accepted inspection', () => {
    const text = describeInspection({
      status: 'accepted',
      kind: 'git',
      name: 'dsh-telegram-connector',
      version: '0.1.0',
      description: 'Telegram control plane',
      host: 'github.com',
      bundle: true,
    })
    expect(text).toContain('**install** `dsh-telegram-connector` 0.1.0')
    expect(text).toContain('git · `github.com` · bundle')
  })

  it('renders the change outcomes', () => {
    expect(describeChange({ changed: true, application: 'applied', bundle: 'x', version: '1.0.0' }, 'installed'))
      .toBe('**installed** `x` 1.0.0.')

    expect(describeChange(
      { changed: true, application: 'restart-required', restartReason: 'no-hmr', target: 'x' },
      'installed',
    )).toContain('restart required (this runtime does not reload plugins live)')

    expect(describeChange(
      { changed: false, application: 'cancelled', target: 'x' },
      'removed',
    )).toContain('nothing changed')

    const failed = describeChange(
      {
        changed: false,
        application: 'failed',
        target: 'x',
        error: { code: 'stop-profile', diagnostic: 'remove it after a restart' },
        packageResult: { exitCode: 1, output: 'ERR_PNPM', logPath: '/tmp/log' },
      },
      'removed',
    )
    expect(failed).toContain('**removed failed** — stop-profile')
    expect(failed).toContain('remove it after a restart')
    expect(failed).toContain('log: `/tmp/log`')

    const incompatible = describeChange(
      {
        changed: false,
        application: 'failed',
        target: 'x@2.0.0',
        error: {
          code: 'incompatible-version',
          incompatible: [{
            name: 'x',
            version: '2.0.0',
            runtimeVersion: '0.2.1-rc.2',
            requirements: { 'engines.dsh': '>=0.3.0' },
          }],
        },
      },
      'installed',
    )
    expect(incompatible).toContain('incompatible-version')
    expect(incompatible).toContain('`x@2.0.0` needs engines.dsh >=0.3.0')
    expect(incompatible).toContain('version exemption')
  })
})
