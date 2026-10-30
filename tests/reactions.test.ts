import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REACTIONS,
  allowedReactionsText,
  canonicalReaction,
  describeReactions,
  isReactionEmoji,
  parseReactionValue,
  resolveReactions,
} from '../src/reactions.js'

describe('reaction emoji', () => {
  it('accepts Telegram reaction emoji and the variation-selector spelling', () => {
    expect(canonicalReaction('👀')).toBe('👀')
    expect(canonicalReaction('✍️')).toBe('✍')
    expect(isReactionEmoji('🎉')).toBe(true)
  })

  it('rejects symbols Telegram does not allow as a reaction', () => {
    expect(canonicalReaction('✓')).toBeUndefined()
    expect(canonicalReaction('✅')).toBeUndefined()
    expect(canonicalReaction('⏳')).toBeUndefined()
    expect(canonicalReaction('not an emoji')).toBeUndefined()
  })
})

describe('parseReactionValue', () => {
  it('treats off/none/- as an explicit disable', () => {
    for (const value of ['off', 'none', '-']) {
      expect(parseReactionValue(value)).toEqual({ value: '' })
    }
  })

  it('returns a canonical emoji or a helpful error', () => {
    expect(parseReactionValue('✍️')).toEqual({ value: '✍' })
    const error = parseReactionValue('✓')
    expect('error' in error && error.error).toContain('not a Telegram reaction')
  })
})

describe('resolveReactions', () => {
  it('uses the defaults when nothing is configured', () => {
    expect(resolveReactions(undefined, undefined)).toEqual(DEFAULT_REACTIONS)
  })

  it('lets durable bindings win over the plugin row', () => {
    expect(resolveReactions({ read: '🤝', streaming: '⚡', staged: '🫡' }, { read: '👀', streaming: '✍', staged: '🙉' })).toMatchObject({
      read: '🤝',
      streaming: '⚡',
      staged: '🫡',
    })
  })

  it('keeps an explicit empty value as "do not react"', () => {
    expect(resolveReactions({ read: '' }, { read: '👀' }).read).toBe('')
  })

  it('ignores an invalid stored value and falls through to the config', () => {
    expect(resolveReactions({ read: '✓' }, { read: '👍' }).read).toBe('👍')
  })

  it('honours a global disable from either source', () => {
    expect(resolveReactions({ enabled: false }, undefined).enabled).toBe(false)
    expect(resolveReactions(undefined, { enabled: false }).enabled).toBe(false)
  })
})

describe('reaction text', () => {
  it('describes the active settings and lists the allowed emoji', () => {
    const text = describeReactions({ enabled: true, read: '👀', streaming: '✍', staged: '🙉' })
    expect(text).toContain('reactions: on')
    expect(text).toContain('read: 👀')
    expect(text).toContain('streaming: ✍')
    expect(text).toContain('staged: 🙉')
    expect(allowedReactionsText()).toContain('👀')
    expect(allowedReactionsText()).not.toContain('✓')
  })
})
