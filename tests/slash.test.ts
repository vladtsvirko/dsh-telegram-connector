import { describe, expect, it } from 'vitest'
import {
  isReservedConnectorCommand,
  normalizeSlashInput,
  parseSlash,
  unescapeLeadingSlash,
  allowedDuringUpdate,
} from '../src/slash.js'

describe('parseSlash', () => {
  it('parses a host command and its arguments', () => {
    expect(parseSlash('/compact now')).toEqual({ name: 'compact', args: 'now' })
    expect(parseSlash('/goal fix the tests')).toEqual({ name: 'goal', args: 'fix the tests' })
    expect(parseSlash('/feedback')).toEqual({ name: 'feedback', args: '' })
  })

  it('ignores whitespace before the first slash and keeps slashes in arguments literal', () => {
    expect(parseSlash('  /compact now')).toEqual({ name: 'compact', args: 'now' })
    expect(parseSlash('/compact see /etc/hosts')).toEqual({ name: 'compact', args: 'see /etc/hosts' })
    expect(parseSlash('hello /compact')).toBeUndefined()
    expect(parseSlash('explain /etc/hosts')).toBeUndefined()
  })

  it('rejects malformed command names', () => {
    expect(parseSlash('/Foo')).toBeUndefined()
    expect(parseSlash('/compact@bot')).toBeUndefined()
    expect(parseSlash('/etc/hosts')).toBeUndefined()
    expect(parseSlash('/compact\nsecond line')).toEqual({ name: 'compact', args: 'second line' })
  })

  it('keeps connector commands reserved', () => {
    expect(isReservedConnectorCommand('compact')).toBe(false)
    expect(isReservedConnectorCommand('model')).toBe(true)
    expect(isReservedConnectorCommand('new')).toBe(true)
    expect(isReservedConnectorCommand('skills')).toBe(true)
    expect(isReservedConnectorCommand('run')).toBe(true)
    expect(isReservedConnectorCommand('skill')).toBe(true)
  })
})

describe('slash normalization', () => {
  it('strips one @bot suffix from the command token only', () => {
    expect(normalizeSlashInput('/commands@my_bot', 'my_bot')).toEqual({
      text: '/commands',
      directedElsewhere: false,
    })
    expect(normalizeSlashInput('  /run status@other', 'my_bot')).toEqual({
      text: '/run status@other',
      directedElsewhere: false,
    })
  })

  it('reports a command addressed to another known bot', () => {
    expect(normalizeSlashInput('/commands@other_bot', 'my_bot')).toEqual({
      text: '/commands@other_bot',
      directedElsewhere: true,
    })
    expect(normalizeSlashInput('/commands@other_bot').directedElsewhere).toBe(false)
  })

  it('leaves ordinary prompt text alone', () => {
    expect(normalizeSlashInput('  hello@bot /path', 'my_bot')).toEqual({
      text: '  hello@bot /path',
      directedElsewhere: false,
    })
    expect(normalizeSlashInput('  /etc/hosts')).toEqual({
      text: '/etc/hosts',
      directedElsewhere: false,
    })
    expect(normalizeSlashInput('  //literal')).toEqual({
      text: '//literal',
      directedElsewhere: false,
    })
  })
})

describe('leading slash escape', () => {
  it('removes exactly one leading slash', () => {
    expect(unescapeLeadingSlash('//etc/hosts')).toEqual({ text: '/etc/hosts', escaped: true })
    expect(unescapeLeadingSlash('///etc/hosts')).toEqual({ text: '//etc/hosts', escaped: true })
    expect(unescapeLeadingSlash('//')).toEqual({ text: '/', escaped: true })
  })

  it('never touches slashes later in the text', () => {
    expect(unescapeLeadingSlash('see //etc/hosts')).toEqual({
      text: 'see //etc/hosts',
      escaped: false,
    })
    expect(unescapeLeadingSlash('/etc/hosts')).toEqual({ text: '/etc/hosts', escaped: false })
  })
})

describe('allowedDuringUpdate', () => {
  it('keeps the recovery commands reachable', () => {
    for (const command of [
      '/system status',
      '/system cancel',
      '/system restart now',
      '/system confirm',
      '/system rollback',
      '/system',
      '/system status',
      '/help',
      '/man',
      '/start',
    ]) {
      expect(allowedDuringUpdate(command)).toBe(true)
    }
  })

  it('blocks anything that starts work', () => {
    for (const command of ['/new', '/sync', '/system update setup', '/system components', '/plugin add x', 'hello', '/workspace new x']) {
      expect(allowedDuringUpdate(command)).toBe(false)
    }
  })
})
