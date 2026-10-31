import { describe, expect, it } from 'vitest'
import {
  attachmentPlaceholder,
  externalMediaDescriptor,
  formatBytes,
  isImageMediaType,
  MAX_TELEGRAM_DOWNLOAD,
  mediaDescriptor,
  stagedKey,
} from '../src/media.js'
import type { TgMessage } from '../src/telegram.js'

function message(overrides: Partial<TgMessage>): TgMessage {
  return {
    message_id: 10,
    chat: { id: -100, type: 'supergroup' },
    from: { id: 7 },
    ...overrides,
  }
}

describe('mediaDescriptor', () => {
  it('uses the largest photo and treats it as a JPEG image', () => {
    const media = mediaDescriptor(message({
      photo: [
        { file_id: 'small', file_unique_id: 's', width: 100, height: 100, file_size: 1000 },
        { file_id: 'large', file_unique_id: 'l', width: 800, height: 600, file_size: 9000 },
      ],
      caption: 'what is this?',
      media_group_id: 'g1',
    }))
    expect(media).toMatchObject({
      kind: 'image',
      fileId: 'large',
      mediaType: 'image/jpeg',
      name: 'photo_10.jpg',
      size: 9000,
      caption: 'what is this?',
      groupId: 'g1',
    })
  })

  it('treats an image document as an image and other documents as files', () => {
    const image = mediaDescriptor(message({
      document: { file_id: 'd1', file_unique_id: 'u1', file_name: 'scan.png', mime_type: 'image/png', file_size: 42 },
    }))
    expect(image).toMatchObject({ kind: 'image', mediaType: 'image/png', name: 'scan.png' })

    const pdf = mediaDescriptor(message({
      document: { file_id: 'd2', file_unique_id: 'u2', file_name: 'report.pdf', mime_type: 'application/pdf' },
    }))
    expect(pdf).toMatchObject({ kind: 'file', mediaType: 'application/pdf', name: 'report.pdf' })
  })

  it('maps video, video note, audio, voice and animation to files', () => {
    expect(mediaDescriptor(message({
      video: { file_id: 'v', file_unique_id: 'u', file_name: 'clip.mp4', mime_type: 'video/mp4', width: 640, height: 480, duration: 3 },
    }))).toMatchObject({ kind: 'file', fileId: 'v', mediaType: 'video/mp4', name: 'clip.mp4' })

    expect(mediaDescriptor(message({
      video_note: { file_id: 'vn', file_unique_id: 'u', length: 240, duration: 5 },
    }))).toMatchObject({ kind: 'file', fileId: 'vn', mediaType: 'video/mp4', name: 'video_note_10.mp4' })

    expect(mediaDescriptor(message({
      audio: { file_id: 'a', file_unique_id: 'u', file_name: 'song.mp3', mime_type: 'audio/mpeg', duration: 120 },
    }))).toMatchObject({ kind: 'file', fileId: 'a', mediaType: 'audio/mpeg', name: 'song.mp3' })

    expect(mediaDescriptor(message({
      voice: { file_id: 'vo', file_unique_id: 'u', mime_type: 'audio/ogg', duration: 8 },
    }))).toMatchObject({ kind: 'file', fileId: 'vo', mediaType: 'audio/ogg', name: 'voice_10.ogg' })

    expect(mediaDescriptor(message({
      animation: { file_id: 'an', file_unique_id: 'u', file_name: 'fun.gif', mime_type: 'image/gif', width: 200, height: 200, duration: 2 },
    }))).toMatchObject({ kind: 'file', fileId: 'an', mediaType: 'image/gif', name: 'fun.gif' })
  })

  it('returns undefined for text and service messages', () => {
    expect(mediaDescriptor(message({ text: 'hello' }))).toBeUndefined()
    expect(mediaDescriptor(message({ forum_topic_created: { name: 'topic' } }))).toBeUndefined()
  })
})

describe('externalMediaDescriptor', () => {
  it('maps media from an external reply and keeps the origin message id', () => {
    const media = externalMediaDescriptor({
      message_id: 77,
      photo: [{ file_id: 'p', file_unique_id: 'u', width: 10, height: 10, file_size: 5 }],
    }, -100)
    expect(media).toMatchObject({ kind: 'image', fileId: 'p', name: 'photo_77.jpg' })
  })

  it('marks media without an origin message id as external', () => {
    const media = externalMediaDescriptor({
      document: { file_id: 'd', file_unique_id: 'u', file_name: 'a.pdf', mime_type: 'application/pdf' },
    }, -100)
    expect(media).toMatchObject({ kind: 'file', fileId: 'd', name: 'external_a.pdf' })
  })
})

describe('media helpers', () => {
  it('knows the image MIME types DSH accepts', () => {
    expect(isImageMediaType('image/png')).toBe(true)
    expect(isImageMediaType('IMAGE/JPEG')).toBe(true)
    expect(isImageMediaType('image/heic')).toBe(false)
    expect(isImageMediaType('application/pdf')).toBe(false)
  })

  it('keys staged media by chat, topic and user', () => {
    expect(stagedKey(-100, 7, 42)).toBe('-100:7:42')
  })

  it('describes an attachment-only prompt', () => {
    expect(attachmentPlaceholder([
      { kind: 'image', fileId: 'a', mediaType: 'image/jpeg', name: 'a.jpg', caption: '' },
    ])).toBe('[image]')
    expect(attachmentPlaceholder([
      { kind: 'image', fileId: 'a', mediaType: 'image/jpeg', name: 'a.jpg', caption: '' },
      { kind: 'file', fileId: 'b', mediaType: 'application/pdf', name: 'b.pdf', caption: '' },
    ])).toBe('[1 image(s) + 1 file(s)]')
  })

  it('formats sizes and exposes the cloud download limit', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(MAX_TELEGRAM_DOWNLOAD)).toBe('20.0 MB')
  })
})
