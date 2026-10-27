/**
 * Topic identity and per-topic workspace directories.
 *
 * The unit is a forum topic: `(chatId, threadId)`. Private chats and a group's
 * General topic have no thread id and collapse to `threadId = 0`.
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export interface TopicKey {
  chatId: number
  threadId: number
  /** `chatId:threadId`, suitable for maps and logs. */
  id: string
}

export function topicKey(chatId: number, threadId?: number): TopicKey {
  const thread = threadId ?? 0
  return { chatId, threadId: thread, id: `${chatId}:${thread}` }
}

/** Lowercase, dash-separated, filesystem-safe rendering of a topic title. */
export function slugify(name: string, fallback: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug.length > 0 ? slug : fallback
}

/** Directory a new workspace gets, created on demand. */
export async function createTopicWorkspace(workspaceRoot: string, title: string, threadId: number): Promise<string> {
  const dir = join(workspaceRoot, slugify(title, `topic-${threadId}`))
  await mkdir(dir, { recursive: true })
  return dir
}
