/**
 * Telegram media → DSH attachment vocabulary.
 *
 * Telegram puts the file on one of several optional message fields (`photo`,
 * `document`, `video`, `video_note`, `audio`, `voice`, `animation`, `sticker`)
 * and the text in `caption`. This module normalizes that into one descriptor;
 * the connector downloads the file lazily and stores it through the DSH
 * attachment service.
 *
 * @module dsh-telegram-connector/media
 */

import type { TgMessage } from './telegram.js'

/** Telegram's cloud Bot API cannot download files larger than this. */
export const MAX_TELEGRAM_DOWNLOAD = 20 * 1024 * 1024

export type MediaKind = 'image' | 'file'

export interface MediaDescriptor {
  kind: MediaKind
  fileId: string
  /** Declared MIME type; verified again by the DSH attachment service for images. */
  mediaType: string
  name: string
  size?: number
  caption: string
  /** Present on every item of an album. */
  groupId?: string
}

const IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

export function isImageMediaType(mediaType: string): boolean {
  return IMAGE_TYPES.has(mediaType.toLowerCase())
}

function mimeFromName(name: string | undefined): string | undefined {
  if (name === undefined) return undefined
  const extension = name.toLowerCase().split('.').pop()
  switch (extension) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'webp': return 'image/webp'
    case 'gif': return 'image/gif'
    default: return undefined
  }
}

export function stagedKey(chatId: number, threadId: number, userId: number): string {
  return `${chatId}:${threadId}:${userId}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function captionOf(message: TgMessage): string {
  return message.caption?.trim() ?? ''
}

function groupOf(message: TgMessage): string | undefined {
  return message.media_group_id
}

function descriptor(
  message: TgMessage,
  input: Omit<MediaDescriptor, 'caption' | 'groupId'>,
): MediaDescriptor {
  return {
    ...input,
    caption: captionOf(message),
    ...(groupOf(message) === undefined ? {} : { groupId: groupOf(message) }),
  }
}

/**
 * Normalize the file carried by one Telegram message. Returns undefined for
 * text, service and unsupported message kinds.
 */
export function mediaDescriptor(message: TgMessage): MediaDescriptor | undefined {
  const photos = message.photo
  if (photos !== undefined && photos.length > 0) {
    const largest = photos[photos.length - 1]
    if (largest === undefined) return undefined
    return descriptor(message, {
      kind: 'image',
      fileId: largest.file_id,
      mediaType: 'image/jpeg',
      name: `photo_${String(message.message_id)}.jpg`,
      ...(largest.file_size === undefined ? {} : { size: largest.file_size }),
    })
  }

  const document = message.document
  if (document !== undefined) {
    const mediaType = document.mime_type ?? mimeFromName(document.file_name) ?? 'application/octet-stream'
    return descriptor(message, {
      kind: isImageMediaType(mediaType) ? 'image' : 'file',
      fileId: document.file_id,
      mediaType,
      name: document.file_name ?? `document_${String(message.message_id)}`,
      ...(document.file_size === undefined ? {} : { size: document.file_size }),
    })
  }

  const video = message.video
  if (video !== undefined) {
    return descriptor(message, {
      kind: 'file',
      fileId: video.file_id,
      mediaType: video.mime_type ?? 'video/mp4',
      name: video.file_name ?? `video_${String(message.message_id)}.mp4`,
      ...(video.file_size === undefined ? {} : { size: video.file_size }),
    })
  }

  const videoNote = message.video_note
  if (videoNote !== undefined) {
    return descriptor(message, {
      kind: 'file',
      fileId: videoNote.file_id,
      mediaType: 'video/mp4',
      name: `video_note_${String(message.message_id)}.mp4`,
      ...(videoNote.file_size === undefined ? {} : { size: videoNote.file_size }),
    })
  }

  const audio = message.audio
  if (audio !== undefined) {
    return descriptor(message, {
      kind: 'file',
      fileId: audio.file_id,
      mediaType: audio.mime_type ?? 'audio/mpeg',
      name: audio.file_name ?? `audio_${String(message.message_id)}.mp3`,
      ...(audio.file_size === undefined ? {} : { size: audio.file_size }),
    })
  }

  const voice = message.voice
  if (voice !== undefined) {
    return descriptor(message, {
      kind: 'file',
      fileId: voice.file_id,
      mediaType: voice.mime_type ?? 'audio/ogg',
      name: `voice_${String(message.message_id)}.ogg`,
      ...(voice.file_size === undefined ? {} : { size: voice.file_size }),
    })
  }

  const animation = message.animation
  if (animation !== undefined) {
    return descriptor(message, {
      kind: 'file',
      fileId: animation.file_id,
      mediaType: animation.mime_type ?? 'video/mp4',
      name: animation.file_name ?? `animation_${String(message.message_id)}.mp4`,
      ...(animation.file_size === undefined ? {} : { size: animation.file_size }),
    })
  }

  const sticker = message.sticker
  if (sticker !== undefined) {
    return descriptor(message, {
      kind: 'file',
      fileId: sticker.file_id,
      mediaType: sticker.mime_type ?? (sticker.is_video === true ? 'video/webm' : 'image/webp'),
      name: `sticker_${String(message.message_id)}`,
      ...(sticker.file_size === undefined ? {} : { size: sticker.file_size }),
    })
  }

  return undefined
}

/** Text used when a prompt carries attachments but no caption/text. */
export function attachmentPlaceholder(items: readonly MediaDescriptor[]): string {
  const images = items.filter((item) => item.kind === 'image').length
  const files = items.length - images
  if (items.length === 1) return items[0]?.kind === 'image' ? '[image]' : '[file]'
  const parts: string[] = []
  if (images > 0) parts.push(`${String(images)} image(s)`)
  if (files > 0) parts.push(`${String(files)} file(s)`)
  return `[${parts.join(' + ')}]`
}
