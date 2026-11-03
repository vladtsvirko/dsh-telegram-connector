import { describe, expect, it } from 'vitest'
import {
  HELD_BY_OTHER_RUNTIME,
  heldByAnotherTopic,
  isOwnershipError,
  OWNERSHIP_HINT,
  SessionHeldError,
} from '../src/errors.js'

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

describe('holder-specific advice', () => {
  it('names the other topic instead of a restart when the bot holds the session twice', () => {
    expect(heldByAnotherTopic(42)).toContain('topic 42')
    expect(heldByAnotherTopic(42)).toContain('/forget')
    expect(heldByAnotherTopic(42)).not.toContain('/system restart')
  })

  it('names the second runtime when no client in this process holds it', () => {
    expect(HELD_BY_OTHER_RUNTIME).toContain('another process')
    expect(HELD_BY_OTHER_RUNTIME).toContain('install.sh --doctor')
    // Stopping the other runtime comes first; a restart of this one is only the
    // last step, never the recovery.
    expect(HELD_BY_OTHER_RUNTIME.indexOf('docker compose down'))
      .toBeLessThan(HELD_BY_OTHER_RUNTIME.indexOf('/system restart now'))
  })
})
