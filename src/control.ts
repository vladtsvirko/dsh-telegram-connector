/**
 * Control-plane screens. Pure CardView builders: the index supplies data and
 * performs the actions, so the same layout renders as a rich message now and
 * as an HTML widget when Telegram re-enables widgets.
 */
import type { CardAction, CardLine, CardRow, CardTile, CardView } from './cards.js'

export interface PluginSummary {
  name: string
  version?: string
  enabled: boolean
  installed: boolean
  removable?: boolean
  source?: string
  description?: string
  error?: string
  rows?: string[]
}

export interface UpdateSlot {
  current?: string
  available?: string
  source?: string
  problem?: string
}

export interface UpdateSnapshot {
  at: number
  connector: UpdateSlot
  penpot: UpdateSlot
  plugins: Array<{ name: string; current?: string; available?: string; spec?: string; problem?: string }>
  setup: { current?: string; available?: string; problem?: string }
}

export interface ComponentSummary {
  name: string
  label: string
  description: string
  enabled: boolean
  port?: number
}

export interface HelpEntry {
  path: string
  usage: string
  summary: string
  details?: string
  examples?: string[]
  group: string
}

export interface HomeAlerts {
  updates?: number
  pluginErrors?: number
  trial?: boolean
  updater?: string
}

const status = (ok: boolean): string => (ok ? '✓' : '○')

function updateLine(slot: UpdateSlot, current?: string): string {
  const now = slot.current ?? current ?? 'unknown'
  if (slot.problem !== undefined) return `${now} · ${slot.problem}`
  if (slot.available === undefined || slot.available === now) return `${now} · current`
  return `${now} → ${slot.available} ↑`
}

export function controlHome(
  version: string,
  counts: { workspaces: number; sessions: number; live: number; polling: boolean; uptime: string },
  alerts: HomeAlerts,
): CardView {
  const notes: string[] = []
  if (alerts.trial === true) notes.push('trial open — commit or roll back')
  if ((alerts.updates ?? 0) > 0) notes.push(`${String(alerts.updates)} update${alerts.updates === 1 ? '' : 's'} available ↑`)
  if ((alerts.pluginErrors ?? 0) > 0) notes.push(`${String(alerts.pluginErrors)} plugin${alerts.pluginErrors === 1 ? '' : 's'} need attention ⚠`)
  if (alerts.updater !== undefined) notes.push(`updates: ${alerts.updater}`)
  return {
    screen: 'home',
    title: 'Control',
    version,
    hero: {
      big: `${String(counts.workspaces)} workspace${counts.workspaces === 1 ? '' : 's'} · ${String(counts.sessions)} session${counts.sessions === 1 ? '' : 's'}`,
      meta: `${String(counts.live)} live · polling ${counts.polling ? 'running' : 'stopped'} · up ${counts.uptime}`,
    },
    ...(notes.length === 0 ? {} : { note: notes.join('\n') }),
    tiles: [
      { title: 'Sessions', meta: 'workspaces & topics', go: 'sessions' },
      { title: 'Plugins', meta: 'bundles & updates', go: 'plugins' },
      { title: 'Updates', meta: 'connector, penpot, setup', go: 'updates' },
      { title: 'Components', meta: 'optional stack', go: 'components' },
      { title: 'System', meta: 'health & restart', go: 'system' },
      { title: 'Settings', meta: 'time, reactions, firewall', go: 'settings' },
      { title: 'Help', meta: 'command manual', go: 'help' },
      { title: 'Web UI', meta: 'open or send link', go: 'web' },
    ],
    caption: `control · ${String(counts.workspaces)} workspaces · ${String(counts.live)} live`,
  }
}

export function pluginsList(plugins: readonly PluginSummary[], factor: number): CardView {
  const rows: CardRow[] = plugins.map((plugin, index) => ({
    title: `${status(plugin.enabled)} ${plugin.name}`,
    meta: `${plugin.version ?? 'unknown'}${plugin.error === undefined ? '' : ` · ${plugin.error}`}`,
    go: `plugin:${String(index)}`,
  }))
  return {
    screen: 'plugins',
    title: 'Plugins',
    version: '',
    back: 'home',
    rows,
    note: rows.length === 0 ? 'No bundles installed.' : `${String(plugins.length)} bundle${plugins.length === 1 ? '' : 's'} · ${String(factor)} update${factor === 1 ? '' : 's'} known`,
    actions: [{ label: 'Add plugin', act: 'plugin:add' }],
    caption: `control · ${String(plugins.length)} plugins`,
  }
}

export function pluginDetail(plugin: PluginSummary, webUrl?: string): CardView {
  const lines: CardLine[] = [
    { k: 'version', v: plugin.version ?? 'unknown' },
    { k: 'state', v: plugin.enabled ? 'enabled' : 'disabled' },
    ...(plugin.source === undefined ? [] : [{ k: 'source', v: plugin.source }]),
    ...(plugin.rows === undefined || plugin.rows.length === 0 ? [] : [{ k: 'rows', v: plugin.rows.join(', ') }]),
    ...(plugin.error === undefined ? [] : [{ k: 'error', v: plugin.error }]),
  ]
  const actions: CardAction[] = []
  if (plugin.source !== undefined) actions.push({ label: 'Update', act: 'plugin:update' })
  actions.push({ label: plugin.enabled ? 'Disable' : 'Enable', act: 'plugin:toggle' })
  if (plugin.removable !== false) actions.push({ label: 'Remove', act: 'plugin:remove', tone: 'bad' })
  if (webUrl !== undefined) actions.push({ label: 'Configure in Web UI', href: webUrl })
  return {
    screen: `plugin:${plugin.name}`,
    title: plugin.name,
    version: plugin.version ?? '',
    back: 'plugins',
    lines,
    note: plugin.description,
    actions,
    caption: `control · plugin · ${plugin.name}`,
  }
}

export function updates(snapshot: UpdateSnapshot | undefined): CardView {
  const lines: CardLine[] = snapshot === undefined ? [
    { k: 'connector', v: 'tap Check for updates' },
    { k: 'penpot', v: 'tap Check for updates' },
    { k: 'plugins', v: 'tap Check for updates' },
    { k: 'setup', v: 'current only' },
  ] : [
    { k: 'connector', v: updateLine(snapshot.connector, snapshot.connector.current) },
    { k: 'penpot', v: updateLine(snapshot.penpot, snapshot.penpot.current) },
    { k: 'plugins', v: snapshot.plugins.length === 0 ? 'current' : `${String(snapshot.plugins.length)} update${snapshot.plugins.length === 1 ? '' : 's'} ↑` },
    { k: 'setup', v: updateLine({ current: snapshot.setup.current, available: snapshot.setup.available, problem: snapshot.setup.problem }, snapshot.setup.current) },
  ]
  return {
    screen: 'updates',
    title: 'Updates',
    version: '',
    back: 'home',
    lines,
    actions: [
      { label: 'Check for updates', act: 'updates:check' },
      { label: 'Connector', act: 'update:connector' },
      { label: 'Penpot', act: 'update:penpot' },
      ...(snapshot === undefined || snapshot.plugins.length === 0 ? [] : [{ label: 'Plugin updates', act: 'update:plugins' }]),
      { label: 'Setup', act: 'update:setup' },
    ],
    caption: 'control · updates',
  }
}

export function updatePreview(label: string, slot: UpdateSlot, note?: string): CardView {
  const current = slot.current ?? 'unknown'
  const available = slot.available
  return {
    screen: `update:${label}`,
    title: `Update ${label}?`,
    version: '',
    back: 'updates',
    lines: [
      { k: 'current', v: current },
      ...(available === undefined ? [] : [{ k: 'available', v: available }]),
      ...(slot.source === undefined ? [] : [{ k: 'source', v: slot.source }]),
      ...(slot.problem === undefined ? [] : [{ k: 'problem', v: slot.problem }]),
    ],
    note,
    actions: [
      { label: 'Start update', act: 'update:start' },
      { label: 'Cancel', act: 'updates' },
    ],
    caption: 'control · updates',
  }
}

export function pluginUpdates(rows: ReadonlyArray<{ name: string; current?: string; available?: string }>): CardView {
  return {
    screen: 'update:plugins',
    title: 'Plugin updates',
    version: '',
    back: 'updates',
    rows: rows.map((row) => ({
      title: row.name,
      meta: `${row.current ?? 'unknown'} → ${row.available ?? 'unknown'} ↑`,
      go: `plugin:${row.name}`,
    })),
    note: rows.length === 0 ? 'Every installed plugin is current.' : undefined,
    caption: 'control · plugin updates',
  }
}

export function componentsList(components: readonly ComponentSummary[]): CardView {
  return {
    screen: 'components',
    title: 'Components',
    version: '',
    back: 'home',
    rows: components.map((component) => ({
      title: `${status(component.enabled)} ${component.label}`,
      meta: component.enabled ? `on · port ${String(component.port ?? '?')}` : 'off',
      go: `component:${component.name}`,
    })),
    note: components.length === 0 ? 'No optional components are registered.' : undefined,
    caption: `control · ${String(components.length)} components`,
  }
}

export function componentDetail(component: ComponentSummary, webUrl?: string): CardView {
  const actions: CardAction[] = [
    { label: component.enabled ? 'Disable' : 'Enable', act: 'component:toggle' },
    { label: 'Change port', act: 'component:port' },
    { label: 'Refresh', act: 'component:refresh' },
    ...(webUrl === undefined ? [] : [{ label: 'Open Web UI', href: webUrl }]),
  ]
  return {
    screen: `component:${component.name}`,
    title: component.label,
    version: '',
    back: 'components',
    lines: [
      { k: 'state', v: component.enabled ? 'on' : 'off' },
      ...(component.port === undefined ? [] : [{ k: 'port', v: String(component.port) }]),
    ],
    note: component.description,
    actions,
    caption: `control · ${component.name}`,
  }
}

export function settings(timezone: string, reactions: string, firewall?: string): CardView {
  return {
    screen: 'settings',
    title: 'Settings',
    version: '',
    back: 'home',
    lines: [
      { k: 'timezone', v: timezone },
      { k: 'reactions', v: reactions },
      ...(firewall === undefined ? [] : [{ k: 'firewall', v: firewall }]),
    ],
    actions: [
      { label: 'Timezone', act: 'setting:timezone' },
      { label: 'Reactions', act: 'setting:reactions' },
      { label: 'Firewall', act: 'setting:firewall' },
      { label: 'Allow web port', act: 'setting:firewallport' },
      { label: 'Take control chat', act: 'setting:takechat' },
    ],
    caption: 'control · settings',
  }
}

export function helpRoot(groups: ReadonlyArray<{ key: string; label: string; count: number }>): CardView {
  return {
    screen: 'help',
    title: 'Help',
    version: '',
    back: 'home',
    rows: groups.map((group) => ({ title: group.label, meta: `${String(group.count)} commands`, go: `helpgroup:${group.key}` })),
    note: 'Pick a category; every command has usage and examples.',
    caption: 'control · help',
  }
}

export function helpGroup(label: string, docs: ReadonlyArray<{ path: string; usage: string; summary: string }>, start: number): CardView {
  return {
    screen: `helpgroup:${label}`,
    title: label,
    version: '',
    back: 'help',
    rows: docs.map((doc, index) => ({ title: doc.usage, meta: doc.summary, go: `helpdoc:${String(start + index)}` })),
    caption: 'control · help',
  }
}

export function helpDoc(doc: HelpEntry): CardView {
  return {
    screen: 'helpdoc',
    title: doc.path,
    version: '',
    back: 'help',
    lines: [{ k: 'usage', v: doc.usage }, ...(doc.details === undefined ? [] : [{ k: 'details', v: doc.details }])],
    note: doc.examples === undefined ? undefined : `examples: ${doc.examples.join(' · ')}`,
    caption: 'control · help',
  }
}

export function webScreen(root: string, signed?: string): CardView {
  return {
    screen: 'web',
    title: 'Web UI',
    version: '',
    back: 'home',
    lines: [{ k: 'link', v: signed === undefined ? 'no signed link on this runtime' : 'signed, single use' }],
    note: 'This link signs you in — treat it like a password.',
    actions: [
      ...(signed === undefined ? [] : [{ label: 'Open Web UI', href: signed }]),
      { label: 'Send link as message', act: 'web:send' },
    ],
    caption: 'control · web',
  }
}

export function promptScreen(title: string, note: string, back: string): CardView {
  return {
    screen: 'prompt',
    title,
    version: '',
    back,
    note,
    actions: [{ label: 'Cancel', act: 'prompt:cancel' }],
    caption: 'control · prompt',
  }
}

export function noticeScreen(title: string, note: string, back: string = 'home'): CardView {
  return {
    screen: title,
    title,
    version: '',
    back,
    note,
    caption: 'control · notice',
  }
}
