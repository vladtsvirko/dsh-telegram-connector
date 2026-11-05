/**
 * Copy that promises behavior is part of the contract: the card and the docs
 * must not disagree about what a command does.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('behavior copy', () => {
  it('says /system cancel still stops an accepted setup update', () => {
    expect(read('src/index.ts')).toContain('still stops the updater job')
    expect(read('src/index.ts')).not.toContain('no longer applies after acceptance')
    expect(read('docs/COMMANDS.md')).toContain('still cancellable')
  })
})
