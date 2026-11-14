import { describe, expect, it } from 'vitest'
import { deflateSync } from 'node:zlib'
import {
  PANEL_ANSWER_BYTES,
  PANEL_COMPRESSED_BYTES,
  PANEL_HTML_BYTES,
  PANEL_MAX_WORKSPACES,
  panelCaption,
  panelComponents,
  panelError,
  panelOk,
  panelPlugins,
  panelSpaces,
  panelStatus,
  renderPanelHtml,
  workspaceLink,
  type PanelComponent,
  type PanelPlugin,
  type PanelState,
  type PanelWorkspace,
} from '../src/panel.js'

function workspace(index: number, overrides: Partial<PanelWorkspace> = {}): PanelWorkspace {
  return {
    id: `ws${String(index).padStart(6, '0')}`,
    title: `workspace ${String(index)}`,
    sessions: index + 1,
    live: index % 3,
    ...overrides,
  }
}

function state(overrides: Partial<PanelState> = {}): PanelState {
  const workspaces = overrides.workspaces ?? [workspace(0, { title: 'dsh-setup', sessions: 4, live: 2 })]
  return {
    version: '0.17.0',
    runtime: '0.2.1-rc.5',
    uptimeSeconds: 3 * 3600 + 12 * 60,
    polling: true,
    workspaces,
    totalWorkspaces: workspaces.length,
    sessions: workspaces.reduce((sum, entry) => sum + entry.sessions, 0),
    live: workspaces.reduce((sum, entry) => sum + entry.live, 0),
    at: 1_763_050_000,
    ...overrides,
  }
}

function component(index: number): PanelComponent {
  return { name: `penpot${String(index)}`, label: `Design stack ${String(index)}`, enabled: index % 2 === 0, port: 8090 + index }
}

function plugin(index: number): PanelPlugin {
  return { name: `@deepseek-ai/dsh-plugin-${String(index)}`, version: `0.${String(index)}.1`, enabled: index % 2 === 0 }
}

describe('workspaceLink', () => {
  it('links a supergroup through the /c/ form', () => {
    expect(workspaceLink(-1001234567890)).toBe('https://t.me/c/1234567890')
  })

  it('has no link for a basic group or a private chat', () => {
    expect(workspaceLink(-12345)).toBeUndefined()
    expect(workspaceLink(42)).toBeUndefined()
    expect(workspaceLink(-100)).toBeUndefined()
  })
})

describe('data payloads', () => {
  it('describes the status tab', () => {
    const status = JSON.parse(panelStatus(state({ updatePending: true, lastError: 'model call failed' }))) as Record<string, unknown>
    expect(status).toMatchObject({ k: 's', ws: 1, se: 4, li: 2, p: 1, po: 1, e: 'model call failed' })
    expect(Buffer.byteLength(panelStatus(state()), 'utf8')).toBeLessThanOrEqual(PANEL_ANSWER_BYTES)
  })

  it('lists workspaces with their links', () => {
    const spaces = JSON.parse(panelSpaces(state({
      workspaces: [workspace(0, { title: 'linked', url: 'https://t.me/c/123' }), workspace(1, { title: 'unlinked' })],
      totalWorkspaces: 2,
    }))) as { k: string; w: { t: string; u?: string }[] }
    expect(spaces.k).toBe('w')
    expect(spaces.w[0]).toMatchObject({ t: 'linked', u: 'https://t.me/c/123' })
    expect(spaces.w[1].u).toBeUndefined()
  })

  it('never exceeds the answer budget, even with hostile titles', () => {
    const workspaces = Array.from({ length: 40 }, (_, index) => workspace(index, {
      title: 'рабочая область с длинным названием ' + String(index),
      url: `https://t.me/c/123456789${String(index)}`,
    }))
    const answer = panelSpaces(state({ workspaces, totalWorkspaces: 40 }))
    expect(Buffer.byteLength(answer, 'utf8')).toBeLessThanOrEqual(PANEL_ANSWER_BYTES)
    const parsed = JSON.parse(answer) as { k: string; w: unknown[] }
    expect(parsed.k).toBe('w')
    expect(parsed.w.length).toBeLessThan(workspaces.length)
  })

  it('lists components and plugins compactly', () => {
    const components = JSON.parse(panelComponents(Array.from({ length: 6 }, (_, index) => component(index)))) as { k: string; c: { n: string; l: string; e: number; p?: number }[] }
    expect(components.k).toBe('c')
    expect(components.c[0]).toEqual({ n: 'penpot0', l: 'Design stack 0', e: 1, p: 8090 })
    const plugins = JSON.parse(panelPlugins(Array.from({ length: 6 }, (_, index) => plugin(index)))) as { k: string; l: { n: string; v?: string; e: number }[] }
    expect(plugins.k).toBe('l')
    expect(plugins.l[0]).toEqual({ n: 'dsh-plugin-0', v: '0.0.1', e: 1 })
    expect(Buffer.byteLength(panelPlugins(Array.from({ length: 6 }, (_, index) => plugin(index))), 'utf8')).toBeLessThanOrEqual(PANEL_ANSWER_BYTES)
  })

  it('caps status and error text', () => {
    expect(panelOk('x'.repeat(500))).toBe(JSON.stringify({ k: 'ok', m: 'x'.repeat(120) }))
    expect(panelError('x'.repeat(500))).toBe(JSON.stringify({ k: 'err', m: 'x'.repeat(160) }))
  })
})

describe('the widget document', () => {
  it('renders the three destinations and the status snapshot', () => {
    const html = renderPanelHtml(state())
    expect(html).toContain('DeepSeek Harness')
    expect(html).toContain('0.17.0')
    expect(html).toContain('DSH 0.2.1-rc.5')
    expect(html).toContain('data-tab="status"')
    expect(html).toContain('data-tab="spaces"')
    expect(html).toContain('data-tab="system"')
    expect(html).toContain('Refresh')
  })

  it('uses the chat palette, not fixed colors', () => {
    const html = renderPanelHtml(state())
    expect(html).toContain('var(--tg-theme-text-color)')
    expect(html).toContain('var(--tg-theme-secondary-bg-color)')
    expect(html).toContain('var(--tg-theme-button-color)')
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(html).not.toContain('http://')
  })

  it('embeds a parseable boot snapshot', () => {
    const html = renderPanelHtml(state({ workspaces: [workspace(0, { url: 'https://t.me/c/1' })], totalWorkspaces: 1 }))
    const match = /var S = (.*?);\n  var T =/s.exec(html)
    expect(match).not.toBeNull()
    const boot = JSON.parse(match?.[1] ?? '{}') as { ws: number; w: { u?: string }[] }
    expect(boot.ws).toBe(1)
    expect(boot.w[0].u).toBe('https://t.me/c/1')
  })

  it('escapes a title in both the markup and the boot data', () => {
    const hostile = '</script><img src=x onerror=alert(1)>'
    const html = renderPanelHtml(state({ workspaces: [workspace(0, { title: hostile })], totalWorkspaces: 1 }))
    expect(html).not.toContain('</script><img')
    expect(html).not.toContain('<img')
    expect(html.match(/<\/script>/g)).toHaveLength(1)
    expect(html).toContain('\\u003c/script')
  })

  it('ships a script that parses as JavaScript', () => {
    const html = renderPanelHtml(state())
    const start = html.indexOf('<script>')
    const end = html.lastIndexOf('</script>')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const script = html.slice(start + '<script>'.length, end)
    expect(() => new Function(script)).not.toThrow()
  })

  it('stays inside the widget size limits', () => {
    const workspaces = Array.from({ length: PANEL_MAX_WORKSPACES }, (_, index) => workspace(index, {
      title: 'очень длинное имя рабочей области ' + String(index),
      url: `https://t.me/c/123456789${String(index)}`,
      sessions: 12 + index,
      live: index,
    }))
    const html = renderPanelHtml(state({
      workspaces,
      totalWorkspaces: 12,
      lastError: 'a long agent error '.repeat(20),
      updatePending: true,
    }))
    expect(Buffer.byteLength(html, 'utf8')).toBeLessThanOrEqual(PANEL_HTML_BYTES)
    expect(deflateSync(html, { level: 9 }).length).toBeLessThan(PANEL_COMPRESSED_BYTES - 150)
    expect(html.includes('\u0000')).toBe(false)
  })
})

describe('the panel caption', () => {
  it('summarizes what a client without widget support shows', () => {
    const caption = panelCaption(state())
    expect(caption).toMatch(/^control · 1 workspace · 4 sessions · 2 live · updated \d\d:\d\d$/)
    expect(caption.length).toBeLessThan(1024)
    expect(caption).not.toContain('\n')
  })
})
