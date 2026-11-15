/**
 * Control-plane screens. Pure CardView builders: the index supplies data and
 * performs the actions, so the same layout renders as a rich message now and
 * as an HTML widget when Telegram re-enables widgets.
 */
import type { CardAction, CardLine, CardRow, CardTile, CardView } from './cards.js'
import type { DevtoolsJob, DevtoolsStatus, DevtoolsTool } from './devtools.js'

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

const toolMeta = (tool: DevtoolsTool): string => {
  if (!tool.installed) return tool.missing ?? 'not installed'
  const facts = [...tool.versions]
  if (tool.sdk !== undefined) facts.push(`SDK ${tool.sdk}`)
  if (tool.auth !== undefined) facts.push(tool.auth)
  return facts.join(' · ')
}

const jobNote = (job: DevtoolsJob | undefined): string | undefined => {
  if (job === undefined) return undefined
  const action = job.action ?? 'job'
  if (job.state === 'done') return `${action} finished`
  if (job.state === 'failed') return `${action} failed${job.error === undefined ? '' : `: ${job.error}`}`
  if (job.state === 'cancelled') return `${action} cancelled`
  return `${action} ${job.state ?? 'running'}${job.stage === undefined ? '' : ` · ${job.stage}`} — tap Refresh`
}

export function devtoolsScreen(status: DevtoolsStatus, job?: DevtoolsJob): CardView {
  return {
    screen: 'devtools',
    title: 'Mobile toolchains',
    version: '',
    back: 'system',
    lines: [
      { k: 'requested', v: status.requested },
      ...(status.diskFreeGb === undefined ? [] : [{ k: 'disk', v: `${String(status.diskFreeGb)} GB free` }]),
    ],
    rows: status.tools.map((tool) => ({
      title: `${tool.installed ? '✓' : '○'} ${tool.label}`,
      meta: toolMeta(tool),
      go: `devtool:${tool.id}`,
    })),
    note: jobNote(job) ?? 'Optional host toolchains. Build without Apple login; deploy is opt-in.',
    actions: [{ label: 'Refresh', act: 'devtools:refresh' }],
    caption: 'control · mobile toolchains',
  }
}

export function devtoolDetail(tool: DevtoolsTool, status: DevtoolsStatus, job?: DevtoolsJob): CardView {
  const actions: CardAction[] = []
  if (tool.id === 'ios') {
    if (!tool.installed) {
      actions.push({ label: 'Install iOS toolchain', act: 'devtool:install' })
    } else {
      actions.push({ label: 'Install SDK', act: 'devtool:sdk' })
      actions.push({ label: 'Login instructions', act: 'devtool:auth-help' })
      if (tool.auth?.startsWith('logged in') === true) actions.push({ label: 'Logout', act: 'devtool:logout', tone: 'bad' })
      actions.push({ label: 'Remove', act: 'devtool:remove', tone: 'bad' })
    }
  } else if (!tool.installed) {
    actions.push({ label: 'Install Android toolchain', act: 'devtool:install' })
  } else {
    actions.push({ label: 'Install / Repair', act: 'devtool:install' })
    actions.push({ label: 'Remove', act: 'devtool:remove', tone: 'bad' })
    actions.push({ label: 'Restart runtime', act: 'system:restartnow' })
  }
  actions.push({ label: 'Refresh', act: 'devtools:refresh' })
  return {
    screen: `devtool:${tool.id}`,
    title: tool.label,
    version: '',
    back: 'devtools',
    lines: [
      { k: 'state', v: tool.installed ? 'installed' : 'missing' },
      ...(tool.versions.length === 0 ? [] : [{ k: 'versions', v: tool.versions.join(' · ') }]),
      ...(tool.sdk === undefined ? [] : [{ k: 'Darwin SDK', v: tool.sdk }]),
      ...(tool.auth === undefined ? [] : [{ k: 'Apple login', v: tool.auth }]),
      { k: 'requested', v: status.requested },
      ...(status.diskFreeGb === undefined ? [] : [{ k: 'disk', v: `${String(status.diskFreeGb)} GB free` }]),
    ],
    note: jobNote(job) ?? (tool.id === 'ios'
      ? 'Builds do not need an Apple login. Login only enables signing and device deploy.'
      : 'No Android Studio or emulator; use the project Gradle wrapper.'),
    actions,
    caption: `control · mobile toolchains · ${tool.id}`,
  }
}

export function devtoolConfirm(tool: DevtoolsTool, action: 'install' | 'remove'): CardView {
  const remove = action === 'remove'
  return {
    screen: `devtool:${tool.id}`,
    title: remove ? `Remove ${tool.label}?` : `${tool.installed ? 'Repair' : 'Install'} ${tool.label}?`,
    version: '',
    back: `devtool:${tool.id}`,
    lines: [
      { k: 'toolchain', v: tool.label },
      { k: 'size', v: 'about 7 GB' },
      ...(tool.id === 'ios' && !remove ? [{ k: 'note', v: 'Xcode.xip is a separate step; Apple login stays optional' }] : []),
      ...(tool.id === 'android' && !remove ? [{ k: 'license', v: 'installing accepts the Android SDK license' }] : []),
      ...(remove ? [{ k: 'keeps', v: 'apt packages, projects, Gradle cache and .env answers' }] : []),
    ],
    note: remove ? 'The toolchain tree and launchers are deleted. This cannot be undone from here.' : 'The updater runs this in the background; the card updates as it goes.',
    actions: [
      { label: remove ? 'Remove' : 'Start install', act: `devtool:${action}!`, tone: remove ? 'bad' : 'pri' },
      { label: 'Cancel', act: 'back' },
    ],
    caption: `control · mobile toolchains · ${action}`,
  }
}

export function devtoolProgress(job: DevtoolsJob): CardView {
  const active = job.state !== undefined && !['done', 'failed', 'cancelled', 'rolled-back'].includes(job.state)
  return {
    screen: 'devtools',
    title: 'Mobile toolchains',
    version: '',
    back: 'devtools',
    lines: [
      { k: 'action', v: job.action ?? 'job' },
      { k: 'state', v: job.state ?? 'running' },
      ...(job.stage === undefined ? [] : [{ k: 'stage', v: job.stage }]),
      ...(job.exitCode === undefined ? [] : [{ k: 'exit', v: String(job.exitCode) }]),
      ...(job.error === undefined ? [] : [{ k: 'error', v: job.error }]),
    ],
    note: active ? 'This can take several minutes; the card refreshes itself.' : 'Finished — Refresh for the new tree.',
    actions: [
      ...(active ? [{ label: 'Cancel job', act: 'devtools:cancel', tone: 'bad' as const }] : []),
      { label: 'Refresh', act: 'devtools:refresh' },
    ],
    caption: 'control · mobile toolchains · job',
  }
}

export function devtoolAuthHelp(): CardView {
  return {
    screen: 'devtool:ios',
    title: 'Apple login',
    version: '',
    back: 'devtool:ios',
    note: 'Login needs a terminal, Apple ID and 2FA, so it cannot run from Telegram.\n\nOn the host:\n  cd /srv/dsh && ./setup.sh devtools login\n\nAfter login, `xtool dev run` can deploy. `logout` removes the token. The agent can deploy too while the token is in dsh home.',
    caption: 'control · mobile toolchains · login',
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
