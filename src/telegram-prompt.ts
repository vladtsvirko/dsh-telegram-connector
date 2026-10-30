/**
 * Telegram-specific agent context.
 *
 * Every Telegram session gets a small system-prompt section that says the user
 * is reading in Telegram and that replies are sent as Telegram rich messages.
 * The full cheat sheet lives in `skills/telegram-rich-text/SKILL.md` and is
 * registered as a runtime skill, so it is loadable on demand without bloating
 * every prompt.
 *
 * @module dsh-telegram-connector/telegram-prompt
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'

export interface SystemPromptSection {
  name: string
  order: number
  text: string
  interpolate?: boolean
}

export interface SystemPromptService {
  section(section: SystemPromptSection): unknown
}

export interface SkillRegistration {
  name: string
  description: string
  whenToUse?: string
  content: string
  invocation?: { modelInvocable: boolean; userInvocable: boolean }
}

export interface SkillRegistryService {
  register(skill: SkillRegistration): unknown
}

/** Stable name/order so a later release can replace the section in place. */
export const TELEGRAM_PROMPT_SECTION: SystemPromptSection = {
  name: 'telegram-surface',
  order: 9000,
  interpolate: false,
  text: [
    '## Telegram replies',
    '',
    'This conversation is delivered through the Telegram connector. The user reads it in Telegram, and the connector sends your Markdown as a Telegram **rich message** (Bot API 10.1+). Prefer structure over long prose: short headings, bullet lists, and narrow tables.',
    '',
    'Use standard Markdown: `##` headings; `**bold**`, `*italic*`, `~~strike~~`, `==mark==`, `||spoiler||`; bullet/ordered/task lists; GFM tables (2–4 columns for phones); fenced code with a language; `> ` quotes; `<details>` for optional depth; `$inline$`/`$$block$$` math; `[links](https://…)`; footnotes; and `<tg-time unix="…" format="…">fallback</tg-time>` for times.',
    '',
    'Do not use MarkdownV2 escaping. Do not use HTML tables. Never wrap the whole answer in a code fence. If a rich construct is unsupported, plain Markdown is fine. Load the `telegram-rich-text` skill for the full cheat sheet.',
  ].join('\n'),
}

const SKILL_FILE = fileURLToPath(new URL('../skills/telegram-rich-text/SKILL.md', import.meta.url))
let cachedBody: string | undefined

/** The skill body without YAML frontmatter; empty when the packaged file is missing. */
export function telegramSkillBody(): string {
  if (cachedBody !== undefined) return cachedBody
  try {
    const raw = readFileSync(SKILL_FILE, 'utf8')
    cachedBody = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()
  } catch {
    cachedBody = ''
  }
  return cachedBody
}

export function telegramSkill(): SkillRegistration | undefined {
  const content = telegramSkillBody()
  if (content.length === 0) return undefined
  return {
    name: 'telegram-rich-text',
    description: 'Format replies as Telegram rich Markdown — headings, tables, lists, details, math, footnotes, tg-time, spoilers and safe fallbacks.',
    whenToUse: 'Use when the user is reading through the Telegram connector, or when a reply benefits from structured rich Markdown (tables, headings, details, math, timestamps).',
    content,
    invocation: { modelInvocable: true, userInvocable: true },
  }
}

function serviceOf<T>(ctx: Context, name: string): T | undefined {
  try {
    const get = (ctx as unknown as { get?: (name: string) => unknown }).get
    return typeof get === 'function' ? (get.call(ctx, name) as T | undefined) : undefined
  } catch {
    return undefined
  }
}

/** Register the cheat sheet once at plugin load; false when the skills service is absent. */
export function registerTelegramSkill(ctx: Context): boolean {
  const skills = serviceOf<SkillRegistryService>(ctx, 'skills')
  const skill = telegramSkill()
  if (skills === undefined || skill === undefined) return false
  try {
    skills.register(skill)
    return true
  } catch {
    return false
  }
}

/** Add the Telegram section to one agent's scoped system prompt. */
export function installTelegramPrompt(agentCtx: Context): boolean {
  const prompt = serviceOf<SystemPromptService>(agentCtx, 'systemPrompt')
  if (prompt === undefined) return false
  try {
    prompt.section(TELEGRAM_PROMPT_SECTION)
    return true
  } catch {
    return false
  }
}
