import { describe, expect, it } from 'vitest'
import { jobActive, normalizeRequested, readDevtoolsStatus, requestedHas } from '../src/devtools.js'
import { devtoolConfirm, devtoolDetail, devtoolsScreen } from '../src/control.js'

const tree: Record<string, string[]> = {
  '/opt/dsh-devtools': ['swift-6.4.2', 'xtool-1.24.0', 'android-sdk'],
  '/opt/dsh-devtools/android-sdk': ['cmdline-tools', 'platforms', 'build-tools', 'ndk'],
  '/opt/dsh-devtools/android-sdk/platforms': ['android-36'],
  '/opt/dsh-devtools/android-sdk/build-tools': ['36.1.0'],
  '/opt/dsh-devtools/android-sdk/ndk': ['30.0.16248370'],
}

describe('devtools status', () => {
  it('reads both trees and the xtool state without changing anything', async () => {
    const seen: string[] = []
    const status = await readDevtoolsStatus({
      requested: 'all',
      list: async (path) => tree[path] ?? [],
      run: async (_command, args) => {
        seen.push(args.join(' '))
        if (args[0] === 'sdk') return 'Darwin SDK is installed\n  Version: epoch=4,darwinTools=1.1.0'
        return 'Logged in.\n- Apple ID: dev@example.com\n- Team ID: TEAM'
      },
      disk: async () => 59,
      now: () => 1,
    })
    expect(status.requested).toBe('ios,android')
    expect(status.tools.find((tool) => tool.id === 'ios')).toMatchObject({
      installed: true,
      versions: ['swift 6.4.2', 'xtool 1.24.0'],
      sdk: 'installed',
      auth: 'logged in as dev@example.com',
    })
    const android = status.tools.find((tool) => tool.id === 'android')
    expect(android?.installed).toBe(true)
    expect(android?.versions).toEqual(expect.arrayContaining(['SDK 36', 'build-tools 36.1.0', 'NDK 30.0.16248370']))
    expect(status.job).toBeUndefined()
    expect(seen).toEqual(['sdk status', 'auth status'])
  })

  it('marks a requested but missing toolchain', async () => {
    const status = await readDevtoolsStatus({
      requested: 'ios',
      list: async (path) => path === '/opt/dsh-devtools' ? [] : [],
      run: async () => 'Logged out',
      disk: async () => 10,
      now: () => 2,
    })
    const ios = status.tools.find((tool) => tool.id === 'ios')
    expect(ios?.installed).toBe(false)
    expect(ios?.missing).toMatch(/requested but not installed/)
    expect(status.tools.find((tool) => tool.id === 'android')?.installed).toBe(false)
  })

  it('normalizes the setup answer', () => {
    expect(normalizeRequested(undefined)).toBe('none')
    expect(normalizeRequested('all')).toBe('ios,android')
    expect(normalizeRequested('android,ios')).toBe('ios,android')
    expect(normalizeRequested('bogus')).toBe('none')
    expect(requestedHas('ios,android', 'android')).toBe(true)
    expect(jobActive({ state: 'running' })).toBe(true)
    expect(jobActive({ state: 'done' })).toBe(false)
  })
})

describe('devtools rich screens', () => {
  const status = {
    requested: 'ios,android',
    diskFreeGb: 59,
    at: 1,
    tools: [
      { id: 'ios' as const, label: 'iOS', installed: true, versions: ['swift 6.4.2', 'xtool 1.24.0'], sdk: '27.2', auth: 'logged out' },
      { id: 'android' as const, label: 'Android', installed: true, versions: ['SDK 36'] },
    ],
  }

  it('shows the System row and both tools', () => {
    const view = devtoolsScreen(status)
    expect(view.back).toBe('system')
    expect(view.rows?.map((row) => row.go)).toEqual(['devtool:ios', 'devtool:android'])
    expect(view.note).toMatch(/Build without Apple login/)
  })

  it('offers the iOS SDK and opt-in login, and Android repair/restart', () => {
    const ios = devtoolDetail(status.tools[0]!, status)
    expect(ios.actions?.map((action) => action.act)).toEqual(expect.arrayContaining(['devtool:sdk', 'devtool:auth-help', 'devtool:remove']))
    const android = devtoolDetail(status.tools[1]!, status)
    expect(android.actions?.map((action) => action.act)).toEqual(expect.arrayContaining(['devtool:install', 'system:restartnow']))
  })

  it('warns before removing', () => {
    const view = devtoolConfirm(status.tools[0]!, 'remove')
    expect(view.actions?.[0]).toMatchObject({ act: 'devtool:remove!', tone: 'bad' })
    expect(view.note).toMatch(/cannot be undone/)
  })
})
