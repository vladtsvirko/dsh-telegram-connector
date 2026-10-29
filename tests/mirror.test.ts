import { describe, expect, it } from 'vitest'
import { MirrorQueue, messageText, promptText } from '../src/mirror.js'

const timeContext = [
  'Time sampled while preparing turn 2, step 1:',
  '2026-10-29T16:28:14+03:00[Europe/Minsk]',
  'Browser time zone for this request: Europe/Minsk. Interpret otherwise-unqualified dates and times in this zone.',
  'Elapsed since the preceding model-visible message: 1d 16h 4m 9s.',
].join('\n')

describe('mirror text', () => {
  it('reads only human prompts', () => {
    expect(promptText({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })).toBe('hello')
  })

  it('does not mirror injected time context', () => {
    expect(promptText({ content: [{ type: 'text', text: timeContext }], source: { kind: 'time-context' } })).toBeUndefined()
  })

  it('does not mirror other synthetic user-role events', () => {
    for (const kind of ['runtime-context', 'skill-catalog', 'goal-continuation', 'skill']) {
      expect(promptText({ content: [{ type: 'text', text: 'notice' }], source: { kind } })).toBeUndefined()
    }
  })

  it('still filters legacy records that carry no source', () => {
    expect(promptText({ content: [{ type: 'text', text: timeContext }] })).toBeUndefined()
    expect(promptText({ content: [{ type: 'text', text: 'real prompt' }] })).toBeUndefined()
  })

  it('extracts the assistant message, not the event envelope', () => {
    const message = {
      content: [
        { type: 'reasoning', text: 'hidden' },
        { type: 'text', text: 'the answer' },
        { type: 'text', text: 'second block' },
      ],
    }
    expect(messageText(message)).toBe('the answer\nsecond block')
  })
})

describe('MirrorQueue', () => {
  it('keeps prompt before answer when the prompt write is slow', async () => {
    const queue = new MirrorQueue()
    const sent: string[] = []
    const prompt = queue.enqueue('chat:1', async () => {
      await new Promise((resolve) => setTimeout(resolve, 25))
      sent.push('prompt')
    })
    const answer = queue.enqueue('chat:1', async () => {
      sent.push('answer')
    })
    await Promise.all([prompt, answer])
    expect(sent).toEqual(['prompt', 'answer'])
  })

  it('keeps independent topics independent', async () => {
    const queue = new MirrorQueue()
    const sent: string[] = []
    const slow = queue.enqueue('chat:1', async () => {
      await new Promise((resolve) => setTimeout(resolve, 25))
      sent.push('slow')
    })
    const fast = queue.enqueue('chat:2', async () => {
      sent.push('fast')
    })
    await Promise.all([slow, fast])
    expect(sent).toEqual(['fast', 'slow'])
  })

  it('continues after a failed task', async () => {
    const errors: unknown[] = []
    const queue = new MirrorQueue((error) => errors.push(error))
    const sent: string[] = []
    await queue.enqueue('chat:1', async () => {
      throw new Error('telegram down')
    })
    await queue.enqueue('chat:1', async () => {
      sent.push('next')
    })
    expect(errors).toHaveLength(1)
    expect(sent).toEqual(['next'])
  })
})
