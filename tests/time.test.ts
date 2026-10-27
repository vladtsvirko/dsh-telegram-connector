import { describe, expect, it } from 'vitest'
import { resolveTimeZone, validTimeZone } from '../src/time.js'

describe('time zones', () => {
  it('accepts IANA names and rejects everything else', () => {
    expect(validTimeZone('Europe/Minsk')).toBe('Europe/Minsk')
    expect(validTimeZone('UTC')).toBe('UTC')
    expect(validTimeZone('Mars/Olympus')).toBeUndefined()
    expect(validTimeZone('')).toBeUndefined()
  })

  it('prefers the stored zone, falls back to the environment, then UTC', () => {
    expect(resolveTimeZone('Europe/Minsk', 'America/New_York')).toBe('Europe/Minsk')
    expect(resolveTimeZone(undefined, 'America/New_York')).toBe('America/New_York')
    expect(resolveTimeZone(undefined, undefined)).toBe('UTC')
    expect(resolveTimeZone('broken', 'America/New_York')).toBe('America/New_York')
    expect(resolveTimeZone('broken', 'also/broken')).toBe('UTC')
  })
})
