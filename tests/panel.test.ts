import { describe, expect, it } from 'vitest'
import { deflateSync } from 'node:zlib'
import {
  PANEL_ANSWER_BYTES,
  PANEL_COMPRESSED_BYTES,
  PANEL_HTML_BYTES,
  PANEL_MAX_WORKSPACES,
  panelCaption,
  panelRefresh,
  renderPanelHtml,
  workspaceLink,
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
    version: '0.16.0',
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

describe('the panel widget', () => {
  it('renders the snapshot without any script', () => {
    const html = renderPanelHtml(state())
    expect(html).toContain('DeepSeek Harness')
    expect(html).toContain('0.16.0')
    expect(html).toContain('DSH 0.2.1-rc.5')
    expect(html).toContain('polling running')
    expect(html).toContain('up 3h 12m')
    expect(html).toContain('1 workspace · 4 sessions · 2 live')
    expect(html).toContain('dsh-setup')
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

  it('turns a workspace with a group into a link and another into a plain row', () => {
    const html = renderPanelHtml(state({
      workspaces: [
        workspace(0, { title: 'linked', url: 'https://t.me/c/123' }),
        workspace(1, { title: 'unlinked' }),
      ],
      totalWorkspaces: 2,
    }))
    expect(html).toContain('<a class="row" href="https://t.me/c/123">')
    expect(html).toContain('<div class="row plain">')
  })

  it('escapes a title in both the markup and the boot data', () => {
    const hostile = '</script><img src=x onerror=alert(1)>'
    const html = renderPanelHtml(state({ workspaces: [workspace(0, { title: hostile })], totalWorkspaces: 1 }))
    expect(html).not.toContain('</script><img')
    expect(html).not.toContain('<img')
    expect(html.match(/<\/script>/g)).toHaveLength(1)
    expect(html).toContain('&lt;/script&gt;')
  })

  it('reports the workspaces it does not list', () => {
    const html = renderPanelHtml(state({
      workspaces: [workspace(0), workspace(1)],
      totalWorkspaces: 5,
    }))
    expect(html).toContain('+3 more — /workspaces lists every workspace')
  })

  it('shows an update gate and an empty state', () => {
    expect(renderPanelHtml(state({ updatePending: true }))).toContain('system update pending')
    const empty = renderPanelHtml(state({ workspaces: [], totalWorkspaces: 0 }))
    expect(empty).toContain('no workspaces yet — send /workspace new')
    expect(empty).toContain('0 workspaces · 0 sessions · 0 live')
  })

  it('ships a script that parses as JavaScript', () => {
    const html = renderPanelHtml(state())
    const start = html.indexOf('<script>')
    const end = html.lastIndexOf('</script>')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const script = html.slice(start + '<script>'.length, end)
    // Syntax only: the widget profile has no DOM here, and a script that does
    // not parse would leave every client with the static snapshot.
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
    expect(deflateSync(html, { level: 9 }).length).toBeLessThan(PANEL_COMPRESSED_BYTES - 200)
    expect(html.includes('\u0000')).toBe(false)
  })
})

describe('the refresh answer', () => {
  it('carries the state the widget redraws from', () => {
    const answer = JSON.parse(panelRefresh(state({ updatePending: true }))) as Record<string, unknown>
    expect(answer.t).toBe('s')
    expect(answer.ws).toBe(1)
    expect(answer.se).toBe(4)
    expect(answer.li).toBe(2)
    expect(answer.p).toBe(1)
    expect(answer.w).toEqual([{ i: 'ws000000', t: 'dsh-setup', s: 4, l: 2 }])
  })

  it('omits an empty error and keeps a real one', () => {
    expect(JSON.parse(panelRefresh(state()))).not.toHaveProperty('e')
    const withError = JSON.parse(panelRefresh(state({ lastError: 'model call failed' }))) as Record<string, unknown>
    expect(withError.e).toBe('model call failed')
  })

  it('never exceeds the answer budget, even with hostile titles', () => {
    const workspaces = Array.from({ length: 40 }, (_, index) => workspace(index, {
      title: 'рабочая область с длинным названием ' + String(index),
    }))
    const answer = panelRefresh(state({
      workspaces,
      totalWorkspaces: 40,
      sessions: 400,
      live: 40,
      lastError: 'x'.repeat(500),
    }))
    expect(Buffer.byteLength(answer, 'utf8')).toBeLessThanOrEqual(PANEL_ANSWER_BYTES)
    const parsed = JSON.parse(answer) as { t: string; ws: number; w: unknown[] }
    expect(parsed.t).toBe('s')
    expect(parsed.ws).toBe(40)
    expect(parsed.w.length).toBeLessThan(workspaces.length)
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
