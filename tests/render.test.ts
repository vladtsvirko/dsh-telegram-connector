import { describe, expect, it } from 'vitest'
import { escapeHtml, splitMessage, toTelegramHtml } from '../src/render.js'

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
})
