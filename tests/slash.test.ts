import { describe, expect, it } from 'vitest'
import { isReservedConnectorCommand, parseSlash } from '../src/slash.js'

describe('parseSlash', () => {
  it('parses a host command and its arguments', () => {
    expect(parseSlash('/compact now')).toEqual({ name: 'compact', args: 'now' })
    expect(parseSlash('/goal fix the tests')).toEqual({ name: 'goal', args: 'fix the tests' })
    expect(parseSlash('/feedback')).toEqual({ name: 'feedback', args: '' })
  })

  it('rejects non-command text', () => {
    expect(parseSlash('/Foo')).toBeUndefined()
    expect(parseSlash('hello /compact')).toBeUndefined()
    expect(parseSlash('/compact@bot')).toBeUndefined()
    expect(parseSlash('/compact\nsecond line')).toEqual({ name: 'compact', args: 'second line' })
  })

  it('keeps connector commands reserved', () => {
    expect(isReservedConnectorCommand('compact')).toBe(false)
    expect(isReservedConnectorCommand('model')).toBe(true)
    expect(isReservedConnectorCommand('new')).toBe(true)
    expect(isReservedConnectorCommand('skills')).toBe(true)
  })
})
