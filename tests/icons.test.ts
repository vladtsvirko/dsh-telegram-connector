/**
 * Controls are words.
 *
 * Telegram renders emoji per client and screen readers announce their names, so
 * a button must be understandable without one. Reactions are the exception:
 * the Bot API only accepts its fixed emoji set.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u

describe('button labels', () => {
  it('never use an emoji as the label', () => {
    const labels = [...source.matchAll(/text: '([^']*)'/g)].map((match) => match[1] ?? '')
    expect(labels.length).toBeGreaterThan(10)
    for (const label of labels) {
      expect(emoji.test(label), `emoji in button label: ${label}`).toBe(false)
    }
  })
})
