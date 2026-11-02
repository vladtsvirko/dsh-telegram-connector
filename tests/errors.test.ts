import { describe, expect, it } from 'vitest'
import { isOwnershipError, OWNERSHIP_HINT, SessionHeldError } from '../src/errors.js'

describe('isOwnershipError', () => {
  it('matches the runtime refusal in both of its wordings', () => {
    expect(isOwnershipError(new Error('session "71ff" is already owned by an active write handle'))).toBe(true)
    expect(isOwnershipError('already owned')).toBe(true)
    expect(isOwnershipError(new Error('active write handle'))).toBe(true)
  })

  it('does not swallow unrelated failures', () => {
    expect(isOwnershipError(new Error('session already exists'))).toBe(false)
    expect(isOwnershipError(new Error('ENOENT'))).toBe(false)
    expect(isOwnershipError(undefined)).toBe(false)
  })

  it('the hint names the recovery that actually works', () => {
    expect(OWNERSHIP_HINT).toContain('/system restart now')
    expect(OWNERSHIP_HINT).not.toMatch(/close it there/i)
  })
})

describe('SessionHeldError', () => {
  it('is recognisable and carries the hint', () => {
    const error = new SessionHeldError()
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('SessionHeldError')
    expect(error.message).toBe(OWNERSHIP_HINT)
  })
})
