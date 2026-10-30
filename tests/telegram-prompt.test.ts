import { describe, expect, it } from 'vitest'
import {
  TELEGRAM_PROMPT_SECTION,
  installTelegramPrompt,
  registerTelegramSkill,
  telegramSkill,
  telegramSkillBody,
} from '../src/telegram-prompt.js'

describe('Telegram prompt section', () => {
  it('has a stable identity and the formatting essentials', () => {
    expect(TELEGRAM_PROMPT_SECTION.name).toBe('telegram-surface')
    expect(TELEGRAM_PROMPT_SECTION.order).toBe(9000)
    expect(TELEGRAM_PROMPT_SECTION.interpolate).toBe(false)
    expect(TELEGRAM_PROMPT_SECTION.text).toContain('Telegram')
    expect(TELEGRAM_PROMPT_SECTION.text).toContain('table')
    expect(TELEGRAM_PROMPT_SECTION.text).toContain('tg-time')
    expect(TELEGRAM_PROMPT_SECTION.text).toContain('telegram-rich-text')
  })

  it('installs on the agent-scoped system prompt service', () => {
    const sections: unknown[] = []
    const ctx = {
      get: (name: string) => name === 'systemPrompt'
        ? { section: (section: unknown) => sections.push(section) }
        : undefined,
    } as never
    expect(installTelegramPrompt(ctx)).toBe(true)
    expect(sections).toEqual([TELEGRAM_PROMPT_SECTION])
  })

  it('no-ops when the system prompt service is absent', () => {
    expect(installTelegramPrompt({ get: () => undefined } as never)).toBe(false)
  })
})

describe('Telegram rich-text skill', () => {
  it('loads the packaged cheat sheet without frontmatter', () => {
    const body = telegramSkillBody()
    expect(body).toContain('## Quick reference')
    expect(body).toContain('## Rules')
    expect(body).not.toMatch(/^---\nname:/)
  })

  it('registers the skill with metadata and content', () => {
    const skills: unknown[] = []
    const ctx = {
      get: (name: string) => name === 'skills'
        ? { register: (skill: unknown) => skills.push(skill) }
        : undefined,
    } as never
    expect(registerTelegramSkill(ctx)).toBe(true)
    expect(skills).toHaveLength(1)
    const skill = skills[0] as { name: string; content: string; whenToUse?: string }
    expect(skill.name).toBe('telegram-rich-text')
    expect(skill.content).toContain('## Quick reference')
    expect(skill.whenToUse).toContain('Telegram')
  })

  it('returns the skill definition for callers that only need metadata', () => {
    const skill = telegramSkill()
    expect(skill?.name).toBe('telegram-rich-text')
    expect(skill?.invocation).toEqual({ modelInvocable: true, userInvocable: true })
  })

  it('no-ops when the skills service is absent', () => {
    expect(registerTelegramSkill({ get: () => undefined } as never)).toBe(false)
  })
})
