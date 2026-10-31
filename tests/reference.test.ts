import { describe, expect, it } from 'vitest'
import {
  formatForwardedReference,
  formatReference,
  forwardOriginLabel,
  forwardedReference,
  mediaReplyPrompt,
  referenceOf,
  referencePrompt,
  richMessageText,
  type ReplyReference,
} from '../src/reference.js'
import type { MediaDescriptor } from '../src/media.js'
import type { TgMessage } from '../src/telegram.js'

function message(overrides: Partial<TgMessage>): TgMessage {
  return {
    message_id: 20,
    chat: { id: -100, type: 'supergroup' },
    from: { id: 7 },
    text: 'new prompt',
    ...overrides,
  }
}

const photo: MediaDescriptor = {
  kind: 'image',
  fileId: 'f1',
  mediaType: 'image/jpeg',
  name: 'photo_10.jpg',
  caption: '',
}

const sameChat: ReplyReference = {
  kind: 'same-chat',
  text: 'the original caption',
  media: [photo],
}

describe('referenceOf', () => {
  it('extracts a same-chat reply with text and media', () => {
    const reference = referenceOf(message({
      reply_to_message: {
        message_id: 10,
        chat: { id: -100, type: 'supergroup' },
        caption: 'original',
        photo: [{ file_id: 'f1', file_unique_id: 'u', width: 10, height: 10 }],
      },
    }))
    expect(reference).toMatchObject({ kind: 'same-chat', text: 'original' })
    expect(reference?.media[0]?.fileId).toBe('f1')
  })

  it('extracts an external reply and its quote', () => {
    const reference = referenceOf(message({
      external_reply: {
        message_id: 77,
        chat: { id: -200, type: 'supergroup', title: 'other group' },
        photo: [{ file_id: 'f2', file_unique_id: 'u', width: 10, height: 10 }],
      },
      quote: { text: 'quoted slice' },
    }))
    expect(reference).toMatchObject({
      kind: 'external',
      text: 'quoted slice',
      chatLabel: 'other group',
    })
    expect(reference?.media[0]?.fileId).toBe('f2')
  })

  it('returns undefined for a plain message', () => {
    expect(referenceOf(message({ text: 'hello' }))).toBeUndefined()
  })

  it('extracts text from a rich-message reply', () => {
    const reference = referenceOf(message({
      reply_to_message: {
        message_id: 10,
        chat: { id: -100, type: 'supergroup' },
        rich_message: {
          blocks: [
            { type: 'section_heading', text: { type: 'bold', text: 'Reference anchor' } },
            { type: 'paragraph', text: 'The quick brown fox jumps over the lazy dog.' },
            { type: 'table', cells: [[{ text: 'REF-2026-10-31-A' }]] },
          ],
        },
      },
    }))
    expect(reference?.text).toContain('Reference anchor')
    expect(reference?.text).toContain('quick brown fox')
    expect(reference?.text).toContain('REF-2026-10-31-A')
  })
})

describe('forwarded messages', () => {
  it('labels a forwarded user message', () => {
    const forward = forwardedReference(message({
      forward_origin: { type: 'user', sender_user: { id: 9, username: 'alice' } },
      text: 'forwarded text',
    }))
    expect(forward).toMatchObject({ originLabel: '@alice', text: 'forwarded text' })
    expect(forwardOriginLabel(message({
      forward_origin: { type: 'user', sender_user: { id: 9, first_name: 'Alice' } },
    }))).toBe('Alice')
  })

  it('extracts rich text from a forwarded rich message', () => {
    const forward = forwardedReference(message({
      text: undefined,
      forward_origin: { type: 'channel', chat: { id: -200, type: 'channel', title: 'Story channel' } },
      rich_message: {
        blocks: [
          { type: 'paragraph', text: 'A lighthouse keeper found a bottle.' },
        ],
      },
    }))
    expect(forward).toMatchObject({ originLabel: 'Story channel' })
    expect(forward?.text).toContain('lighthouse keeper')
  })

  it('falls back to legacy forward fields', () => {
    expect(forwardOriginLabel(message({
      forward_from: { id: 9, username: 'bob' },
    }))).toBe('@bob')
    expect(forwardOriginLabel(message({
      forward_from_chat: { id: -300, type: 'channel', title: 'Old channel' },
    }))).toBe('Old channel')
  })

  it('formats a forwarded context block', () => {
    const forward = forwardedReference(message({
      forward_origin: { type: 'user', sender_user: { id: 9, username: 'alice' } },
      text: 'forwarded text',
    }))
    expect(forward).toBeDefined()
    const text = formatForwardedReference(forward!)
    expect(text).toContain('Forwarded message')
    expect(text).toContain('Forwarded from: @alice')
    expect(text).toContain('> forwarded text')
  })

  it('marks a referenced message that was itself forwarded', () => {
    const reference = referenceOf(message({
      reply_to_message: {
        message_id: 10,
        chat: { id: -100, type: 'supergroup' },
        text: 'forwarded original',
        forward_origin: { type: 'user', sender_user: { id: 9, username: 'alice' } },
      },
    }))
    expect(reference?.forwardedFrom).toBe('@alice')
    expect(formatReference(reference!)).toContain('(forwarded from @alice)')
  })

  it('returns undefined for a plain message', () => {
    expect(forwardedReference(message({ text: 'hello' }))).toBeUndefined()
  })
})

describe('richMessageText', () => {
  it('flattens nested rich text and skips layout metadata', () => {
    const text = richMessageText({
      blocks: [
        { type: 'paragraph', align: 'left', text: { type: 'bold', text: 'bold' } },
        { type: 'table', is_bordered: true, cells: [[{ text: 'cell' }]] },
      ],
    })
    expect(text).toBe('bold cell')
  })
})

describe('reference prompts', () => {
  it('quotes the referenced message and names its media', () => {
    const text = formatReference(sameChat)
    expect(text).toContain('Reference context')
    expect(text).toContain('Referenced message:')
    expect(text).toContain('> the original caption')
    expect(text).toContain('Referenced media: photo_10.jpg')
  })

  it('labels an external reply and its origin chat', () => {
    const text = formatReference({
      kind: 'external',
      text: 'quoted slice',
      chatLabel: 'other group',
      media: [],
    })
    expect(text).toContain('another chat/topic')
    expect(text).toContain('Referenced message from other group:')
    expect(text).toContain('> quoted slice')
    expect(text).not.toContain('Referenced media:')
  })

  it('surfaces download errors so the model can suggest a fix', () => {
    const text = formatReference(sameChat, ['photo_10.jpg: chat not found'])
    expect(text).toContain('could not be downloaded')
    expect(text).toContain('re-upload it')
  })

  it('puts the user text before the reference block', () => {
    const text = referencePrompt('take this for later', sameChat)
    expect(text.startsWith('take this for later')).toBe(true)
    expect(text).toContain('wait for the follow-up')
  })

  it('marks the new media as the task in a media reply', () => {
    const text = mediaReplyPrompt('compare these', sameChat)
    expect(text.startsWith('compare these')).toBe(true)
    expect(text).toContain('The new media is the task')
    expect(text).toContain('Referenced message:')
  })

  it('quotes every line of a multi-line reference', () => {
    const text = formatReference({ kind: 'same-chat', text: 'line one\nline two', media: [] })
    expect(text).toContain('> line one\n> line two')
  })
})
