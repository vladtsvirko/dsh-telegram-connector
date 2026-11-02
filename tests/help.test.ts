import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { hasHelpFlag, indexText, lookupText, manualText, stripHelpFlag,
  commandMenu,
} from '../src/help.js'

describe('help registry', () => {
  it('lists control commands and keeps dashboard commands out', () => {
    const index = indexText('control')
    expect(index).toContain('/plugins')
    expect(index).toContain('/plugin add <spec>')
    expect(index).toContain('/system restart [now]')
    expect(index).not.toContain('`/sync` — ')
  })

  it('lists the dashboard surface and points at the bot chat', () => {
    const index = indexText('dashboard')
    expect(index).toContain('/new [title]')
    expect(index).toContain('/sync')
    expect(index).toContain('bot chat')
    expect(index).not.toContain('/plugin add')
  })

  it('gives a session topic help, man, commands and skills', () => {
    const index = indexText('session')
    expect(index).toContain('/help')
    expect(index).toContain('/man')
    expect(index).toContain('/commands')
    expect(index).toContain('/skills')
    expect(index).toContain('/run <command> [args]')
    expect(index).toContain('/skill <name> [args]')
    expect(index).not.toContain('`/sync` — ')
    expect(index).not.toContain('/system')
  })

  it('resolves a command, an alias and a --help spelling', () => {
    expect(lookupText('plugin add', 'control')).toContain('github:owner/repo')
    expect(lookupText('/plugin rm', 'control')).toContain('/plugin remove <name>')
    expect(lookupText('/workspace new', 'control')).toContain('startgroup')
    expect(lookupText('run', 'session')).toContain('name collisions')
    expect(lookupText('skill', 'session')).toContain('host command')
    expect(lookupText('nope', 'control')).toBeUndefined()
  })

  it('explains a command that belongs to another surface', () => {
    const text = lookupText('system restart', 'dashboard')
    expect(text).toContain('available in the bot chat')
  })

  it('prints the manual with details and examples', () => {
    const manual = manualText('control')
    expect(manual).toContain('# plugins')
    expect(manual).toContain('/plugin add <spec>')
    expect(manual).toContain('/plugin add github:owner/repo')
  })

  it('documents every dispatched command', () => {
    const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    const literals = new Set(
      [...source.matchAll(/command === '(\/[a-z]+)'/g)].map((match) => match[1]!.slice(1)),
    )
    expect(literals.size).toBeGreaterThan(20)
    for (const command of literals) {
      const found = lookupText(command, 'control')
        ?? lookupText(command, 'dashboard')
        ?? lookupText(command, 'session')
      expect(found, `no help entry for /${command}`).toBeDefined()
    }
  })

  it('recognises and strips --help', () => {
    expect(hasHelpFlag(['add', '--help'])).toBe(true)
    expect(hasHelpFlag(['-h'])).toBe(true)
    expect(hasHelpFlag(['add'])).toBe(false)
    expect(stripHelpFlag(['add', '--help'])).toEqual(['add'])
  })
})

describe('commandMenu', () => {
  it('offers the private commands to the bot chat', () => {
    const menu = commandMenu('private')
    const names = menu.map((entry) => entry.command)
    expect(names).toContain('system')
    expect(names).toContain('web')
    expect(names).toContain('plugins')
    // Commands that only exist in a group must not appear in the bot chat menu.
    expect(names).not.toContain('sync')
    expect(names).not.toContain('bind')
  })

  it('offers the group commands to groups, and nothing for the bot chat only', () => {
    const names = commandMenu('group').map((entry) => entry.command)
    expect(names).toContain('help')
    expect(names).toContain('commands')
    expect(names).not.toContain('plugins')
    expect(names).not.toContain('system')
  })

  it('fits what Telegram accepts', () => {
    for (const scope of ['private', 'group']) {
      const menu = commandMenu(scope)
      expect(menu.length).toBeLessThanOrEqual(100)
      for (const entry of menu) {
        expect(entry.command.length).toBeGreaterThan(0)
        expect(entry.command.length).toBeLessThanOrEqual(32)
        expect(entry.command).not.toContain(' ')
        expect(entry.description.length).toBeLessThanOrEqual(256)
      }
      expect(new Set(menu.map((entry) => entry.command)).size).toBe(menu.length)
    }
  })
})
