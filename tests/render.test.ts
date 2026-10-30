import { describe, expect, it } from 'vitest'
import { escapeHtml, hasTable, splitMessage, toPlainText, toRichMarkdown, toTelegramHtml } from '../src/render.js'

describe('escapeHtml', () => {
  it('escapes the three characters Telegram cares about', () => {
    expect(escapeHtml('<b>a & b</b>')).toBe('&lt;b&gt;a &amp; b&lt;/b&gt;')
  })
})

describe('toTelegramHtml', () => {
  it('renders bold, italics, inline code and links', () => {
    const html = toTelegramHtml('**bold** and *italic* and `code` and [link](https://example.com/x)')
    expect(html).toContain('<b>bold</b>')
    expect(html).toContain('<i>italic</i>')
    expect(html).toContain('<code>code</code>')
    expect(html).toContain('<a href="https://example.com/x">link</a>')
  })

  it('keeps fenced blocks verbatim and escaped', () => {
    const html = toTelegramHtml('before\n```ts\nconst a = 1 < 2 && 3 > 2\n```\nafter')
    expect(html).toContain('<pre><code class="language-ts">')
    expect(html).toContain('const a = 1 &lt; 2 &amp;&amp; 3 &gt; 2')
    expect(html).not.toContain('<b>')
  })

  it('leaves unknown markup alone rather than emitting broken tags', () => {
    expect(toTelegramHtml('a < b')).toBe('a &lt; b')
    expect(toTelegramHtml('`unclosed')).toContain('`unclosed')
  })

  it('lets a validated tg-time tag through and escapes its fallback', () => {
    const html = toTelegramHtml('rolls back <tg-time unix="1793092339" format="r">in 5 <min></tg-time>')
    expect(html).toContain('<tg-time unix="1793092339" format="r">in 5 &lt;min&gt;</tg-time>')
  })

  it('refuses an invalid tg-time format and keeps the fallback as text', () => {
    expect(toTelegramHtml('<tg-time unix="1793092339" format="zzz">in 5 min</tg-time>')).toBe('in 5 min')
  })

  it('renders a Markdown table as a monospaced fallback, not raw pipes', () => {
    const table = '| Name | Status |\n|:-----|-------:|\n| build | **ok** |\n| test | `pass` |'
    const html = toTelegramHtml(table)
    expect(html).toContain('<pre>')
    expect(html).toContain('Name')
    expect(html).toContain('build')
    expect(html).toContain('----')
    expect(html).not.toContain('**')
    expect(html).not.toContain('`pass`')
  })

  it('escapes HTML inside a table cell', () => {
    const html = toTelegramHtml('| A |\n|---|\n| <b>x</b> & y |')
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt; &amp; y')
  })

  it('falls back to a key/value list for a table too wide for a phone', () => {
    const table = [
      '| A | B | C | D | E | F | G |',
      '|---|---|---|---|---|---|---|',
      '| one | two | three | four | five | six | seven |',
    ].join('\n')
    const html = toTelegramHtml(table)
    expect(html).not.toContain('<pre>')
    expect(html).toContain('<b>one</b>')
    expect(html).toContain('B: two')
    expect(html).toContain('·')
  })

  it('renders headings and lists without leaving Markdown markers', () => {
    const html = toTelegramHtml('## Summary\n\n- first\n- second\n\n1. ordered')
    expect(html).toContain('<b>Summary</b>')
    expect(html).toContain('• first')
    expect(html).toContain('1. ordered')
    expect(html).not.toContain('##')
  })
})

describe('toPlainText', () => {
  it('never leaks Markdown table or emphasis source into the last-resort text', () => {
    const text = toPlainText('**bold** and `code`\n\n| A | B |\n|---|---|\n| one | two |')
    expect(text).not.toContain('**')
    expect(text).not.toContain('`code`')
    expect(text).toContain('one')
    expect(text).toContain('two')
  })

  it('keeps the fallback text of a tg-time tag', () => {
    expect(toPlainText('<tg-time unix="1793092339" format="r">in 5 min</tg-time>')).toBe('in 5 min')
  })
})

describe('hasTable', () => {
  it('detects a table but not a stray pipe in prose', () => {
    expect(hasTable('| A | B |\n|---|---|\n| 1 | 2 |')).toBe(true)
    expect(hasTable('a | b is not a table')).toBe(false)
  })

  it('ignores a table that is only code-block content', () => {
    expect(hasTable('```md\n| A | B |\n|---|---|\n| 1 | 2 |\n```')).toBe(false)
  })
})

describe('toRichMarkdown', () => {
  it('normalizes line endings and drops NUL padding', () => {
    expect(toRichMarkdown('a\r\nb\u0000')).toBe('a\nb')
  })
})

describe('splitMessage', () => {
  it('returns a single chunk when it fits', () => {
    expect(splitMessage('short')).toEqual(['short'])
  })

  it('splits on newlines and never exceeds the limit', () => {
    const text = Array.from({ length: 200 }, (_, index) => `line ${index} ${'x'.repeat(40)}`).join('\n')
    const chunks = splitMessage(text, 500)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(500)
    expect(chunks.join('\n')).toBe(text)
  })

  it('closes and reopens fenced blocks across a split', () => {
    const code = Array.from({ length: 80 }, (_, index) => `const v${index} = ${index}`).join('\n')
    const chunks = splitMessage('```js\n' + code + '\n```', 400)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      const fences = (chunk.match(/^```/gm) ?? []).length
      expect(fences % 2).toBe(0)
    }
  })

  it('hard-cuts a line longer than the limit', () => {
    const chunks = splitMessage('y'.repeat(120), 50)
    expect(chunks.every((chunk) => chunk.length <= 50)).toBe(true)
    expect(chunks.join('')).toBe('y'.repeat(120))
  })

  it('repeats a table header when a table has to be split', () => {
    const table = '| H1 | H2 |\n|----|----|\n'
      + Array.from({ length: 40 }, (_, index) => `| row${index} | value${index} |`).join('\n')
    const chunks = splitMessage(table, 160)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      if (!chunk.includes('row')) continue
      expect(chunk).toContain('| H1 | H2 |')
      expect(chunk).toContain('|----|----|')
    }
  })
})
