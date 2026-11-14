import { describe, expect, it } from 'vitest'
import { deflateSync } from 'node:zlib'
import { CARD_COMPRESSED_BYTES, CARD_HTML_BYTES, renderCard, type CardView } from '../src/cards.js'

function view(overrides: Partial<CardView> = {}): CardView {
  return {
    screen: 'home',
    title: 'Control',
    version: '0.19.0',
    caption: 'control · 1 workspace',
    ...overrides,
  }
}

function script(html: string): string {
  const start = html.indexOf('<script>')
  const end = html.lastIndexOf('</script>')
  return html.slice(start + '<script>'.length, end)
}

describe('the card renderer', () => {
  it('renders a home card with tiles', () => {
    const html = renderCard(view({
      hero: { big: '2 workspaces · 5 sessions', meta: '3 live · polling running · up 2h 5m' },
      tiles: [
        { title: 'Sessions', meta: 'workspaces & topics', go: 'sessions' },
        { title: 'System', meta: 'health & restart', go: 'system' },
      ],
    }))
    expect(html).toContain('2 workspaces · 5 sessions')
    expect(html).toContain('go("sessions")')
    expect(html).toContain('Sessions')
    expect(html).toContain('System')
  })

  it('renders rows, lines, chips and actions', () => {
    const html = renderCard(view({
      screen: 'session',
      title: 'topic 7',
      back: 'workspace:ws1',
      lines: [{ k: 'model', v: 'opencode-go/glm-5' }],
      chips: {
        label: 'model',
        items: [
          { label: 'GLM', value: 'opencode-go/glm-5', on: true },
          { label: 'Kimi', value: 'opencode-go/kimi' },
        ],
        apply: 'model:ws1:s1',
      },
      actions: [
        { label: 'Open topic', href: 'https://t.me/c/1/7' },
        { label: 'Forget', act: 'forget:ws1:s1', tone: 'bad' },
      ],
    }))
    expect(html).toContain('model')
    expect(html).toContain('opencode-go/glm-5')
    expect(html).toContain('chip on')
    expect(html).toContain('https://t.me/c/1/7')
    expect(html).toContain('go("workspace:ws1")')
  })

  it('escapes user text', () => {
    const html = renderCard(view({ title: '</script><b>x', rows: [{ title: 'a"b<c', meta: 'd' }] }))
    expect(html).not.toContain('</script><b>x')
    expect(html).toContain('&lt;/script&gt;')
    expect(html).toContain('a"b&lt;c')
  })

  it('ships a script that parses', () => {
    const html = renderCard(view({ chips: { label: 'model', items: [{ label: 'x', value: 'p/m' }], apply: 'model:ws:s' } }))
    expect(() => new Function(script(html))).not.toThrow()
  })

  it('stays inside Telegram limits on every screen', () => {
    const screens: CardView[] = [
      view({ screen: 'home', tiles: Array.from({ length: 4 }, (_, index) => ({ title: 'Tile ' + String(index), meta: 'meta ' + String(index), go: 'sessions' })), hero: { big: '12 workspaces · 60 sessions', meta: '12 live · polling running · up 11h 55m' } }),
      view({ screen: 'system', lines: Array.from({ length: 12 }, (_, index) => ({ k: 'key ' + String(index), v: 'value ' + String(index) })), actions: [{ label: 'Restart', act: 'restart', tone: 'bad' }] }),
      view({ screen: 'sessions', rows: Array.from({ length: 8 }, (_, index) => ({ title: 'рабочая область ' + String(index), meta: '12 sessions · 11 live', go: 'workspace:ws' + String(index) })) }),
      view({ screen: 'workspace', rows: Array.from({ length: 8 }, (_, index) => ({ title: 'session ' + String(index), meta: 'live · opencode-go/glm-5', go: 'session:ws:s' + String(index) })), actions: [{ label: 'Open group', href: 'https://t.me/c/1234567890' }] }),
      view({ screen: 'session', lines: Array.from({ length: 5 }, (_, index) => ({ k: 'k' + String(index), v: 'v' + String(index) })), chips: { label: 'model', items: Array.from({ length: 8 }, (_, index) => ({ label: 'model ' + String(index), value: 'provider/model-' + String(index) })), apply: 'model:ws:s' }, actions: [{ label: 'Open topic', href: 'https://t.me/c/1234567890/7' }, { label: 'Forget', act: 'forget:ws:s', tone: 'bad' }] }),
    ]
    for (const card of screens) {
      const html = renderCard(card)
      expect(Buffer.byteLength(html, 'utf8')).toBeLessThanOrEqual(CARD_HTML_BYTES)
      expect(deflateSync(html, { level: 9 }).length).toBeLessThan(CARD_COMPRESSED_BYTES - 150)
    }
  })
})
