import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SessionBridge } from '../src/bridge.js'

describe('SessionBridge', () => {
  it('journals turns and inputs, and survives a restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bridge-'))
    try {
      const first = new SessionBridge(dir)
      await first.start()
      const turn = await first.recordTurn('s1', 'answer', 'question')
      const input = await first.recordInput('s1', 'next')

      const second = new SessionBridge(dir)
      await second.start()
      expect(second.pendingTurns().map((entry) => entry.assistant)).toEqual(['answer'])
      expect(second.pendingInputs().map((entry) => entry.text)).toEqual(['next'])

      await second.completeTurn(turn.id)
      await second.completeInput(input.id)
      expect(second.pendingTurns()).toEqual([])
      expect(second.pendingInputs()).toEqual([])

      const third = new SessionBridge(dir)
      await third.start()
      expect(third.pendingTurns()).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps session order by time', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bridge-'))
    try {
      const bridge = new SessionBridge(dir)
      await bridge.start()
      const later = await bridge.recordTurn('s2', 'two')
      await new Promise((resolve) => setTimeout(resolve, 5))
      const first = await bridge.recordTurn('s1', 'one')
      expect(bridge.pendingTurns().map((entry) => entry.id)).toEqual([later.id, first.id])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
