import { describe, expect, it } from 'vitest'
import {
  commandLabel,
  formatLiveProcess,
  formatProcessSummary,
  formatProcessSummaryText,
  processLine,
  redactPreview,
  redactSecrets,
  toolLabel,
  type ProcessItem,
} from '../src/process.js'

const bash: ProcessItem = {
  id: 'tool:1',
  kind: 'tool',
  label: '💻 pnpm test',
  status: 'running',
}

const skill: ProcessItem = {
  id: 'skill:1',
  kind: 'skill',
  label: '🧠 Skill: telegram-rich-text',
  status: 'done',
}

const failed: ProcessItem = {
  id: 'tool:2',
  kind: 'tool',
  label: '📖 Read: src/index.ts',
  status: 'error',
  detail: 'not found',
}

describe('process labels', () => {
  it('labels tools with safe previews', () => {
    expect(toolLabel('skill', '{"name":"telegram-rich-text"}')).toBe('🧠 Skill: telegram-rich-text')
    expect(toolLabel('bash', '{"command":"pnpm test"}')).toBe('💻 pnpm test')
    expect(toolLabel('read', '{"path":"src/index.ts"}')).toBe('📖 Read: src/index.ts')
    expect(toolLabel('web_fetch', '{"url":"https://core.telegram.org/bots/api"}')).toBe('🌐 Fetch: core.telegram.org')
    expect(toolLabel('unknown')).toBe('🔧 unknown')
  })

  it('redacts credentials and truncates', () => {
    expect(redactPreview('TOKEN=abc123 curl https://x.test')).toBe('TOKEN=<redacted> curl https://x.test')
    expect(redactPreview('curl -H "Authorization: Bearer abc"')).toBe('curl -H "Authorization: Bearer <redacted>"')
    expect(redactPreview('https://user:pass@example.test/x')).toBe('https://<redacted>@example.test/x')
    expect(redactPreview('x'.repeat(200)).endsWith('…')).toBe(true)
  })

  it('redacts secrets without collapsing or truncating the rest', () => {
    const text = 'line one\nTOKEN=abc123\nline three is long'
    expect(redactSecrets(text)).toBe('line one\nTOKEN=<redacted>\nline three is long')
    expect(redactSecrets('--password hunter2 run')).toBe('--password <redacted> run')
  })

  it('labels commands and skills', () => {
    expect(commandLabel('compact', ' now ')).toBe('⚡ /compact now')
    expect(commandLabel('compact')).toBe('⚡ /compact')
  })
})

describe('process rendering', () => {
  it('shows a live card with running and done rows', () => {
    const text = formatLiveProcess([bash, skill])
    expect(text.startsWith('⚙️ Working…')).toBe(true)
    expect(text).toContain('⏳ 💻 pnpm test')
    expect(text).toContain('• 🧠 Skill: telegram-rich-text')
  })

  it('renders a collapsed summary with errors', () => {
    const text = formatProcessSummary([bash, skill, failed])
    expect(text).toContain('<details><summary>Process · 3 steps</summary>')
    expect(text).toContain('• 💻 pnpm test')
    expect(text).toContain('⚠️ 📖 Read: src/index.ts — not found')
    expect(text.endsWith('</details>')).toBe(true)
  })

  it('accepts a custom summary heading', () => {
    expect(formatProcessSummary([skill], { heading: '✅ Process' })).toContain(
      '<details><summary>✅ Process · 1 step</summary>',
    )
    expect(formatProcessSummaryText([skill], { heading: '⚠️ Process interrupted' })).toContain(
      '⚠️ Process interrupted · 1 step',
    )
  })

  it('provides a plain fallback', () => {
    const text = formatProcessSummaryText([bash, skill])
    expect(text.startsWith('Process · 2 steps')).toBe(true)
    expect(text).toContain('• 💻 pnpm test')
  })

  it('renders one line with detail', () => {
    expect(processLine(failed)).toBe('⚠️ 📖 Read: src/index.ts — not found')
  })
})
