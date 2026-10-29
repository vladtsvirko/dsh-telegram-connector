/**
 * The command manual.
 *
 * One registry drives `/help`, `/man` and `<command> --help` on all three
 * surfaces (the bot chat, the workspace dashboard, a session topic), so the
 * text cannot drift between the index, the detail view and the README.
 *
 * @module dsh-telegram-connector/help
 */

export type Surface = 'control' | 'dashboard' | 'session'

export interface CommandDoc {
  /** Command path without a slash, e.g. `plugin add`. */
  path: string
  /** Canonical invocation, e.g. `/plugin add <spec>`. */
  usage: string
  summary: string
  details?: string
  examples?: string[]
  surfaces: Surface[]
  group: string
  aliases?: string[]
}

const GROUP_ORDER = ['start', 'workspace', 'sessions', 'plugins', 'system', 'runtime', 'time']

const ALIASES: Record<string, string> = {
  start: 'help',
  '?': 'help',
  'plugin list': 'plugins',
  'plugin install': 'plugin add',
  'plugin rm': 'plugin remove',
  'plugin del': 'plugin remove',
}

const SURFACE_NOTE: Record<Surface, string> = {
  control:
    'This chat is the control plane. Session commands live in a group\'s system topic; each topic is one session.',
  dashboard:
    'This topic owns this group\'s workspace. Plugin, restart, update and timezone commands live in the bot chat.',
  session:
    'This topic is one session — plain text is a turn. Commands live in the system topic; `/help` and `/man` work here too.',
}

const COMMANDS: CommandDoc[] = [
  {
    path: 'help',
    usage: '/help [command]',
    aliases: ['/start'],
    summary: 'list the commands available in this chat',
    details:
      'With a command name it shows that command. `<command> --help` does the same. `/man` prints the full manual.',
    examples: ['/help', '/help plugin add', '/system restart --help'],
    surfaces: ['control', 'dashboard', 'session'],
    group: 'start',
  },
  {
    path: 'man',
    usage: '/man [command]',
    summary: 'the full manual, with semantics and examples',
    details: 'Same as `/help` but includes every detail, caveat and example.',
    surfaces: ['control', 'dashboard', 'session'],
    group: 'start',
  },
  {
    path: 'workspaces',
    usage: '/workspaces',
    summary: 'list workspaces, their group and their link',
    details: 'A workspace with no group gets a one-tap link that adds the bot to a new group.',
    surfaces: ['control'],
    group: 'workspace',
  },
  {
    path: 'workspace new',
    usage: '/workspace new <title>',
    summary: 'create a workspace directory and register it in DSH',
    details:
      'Creates `<workspaceRoot>/<slug>` and prints a `t.me/…?startgroup=workspace_<id>` link. The group must have Topics enabled and the bot must be admin with Manage Topics.',
    examples: ['/workspace new web-app'],
    surfaces: ['control'],
    group: 'workspace',
  },
  {
    path: 'workspace link',
    usage: '/workspace link <name>',
    summary: 'print the startgroup link again',
    details: '`<name>` matches the workspace id, a prefix, its title or its path basename.',
    surfaces: ['control'],
    group: 'workspace',
  },
  {
    path: 'workspace rm',
    usage: '/workspace rm <name>',
    summary: 'unregister a workspace and clear its group',
    details:
      'Removes the workspace from DSH, deletes the binding, and deletes that group\'s session topics. The directory, the sessions and the group itself are untouched.',
    surfaces: ['control'],
    group: 'workspace',
  },
  {
    path: 'plugins',
    usage: '/plugins',
    aliases: ['/plugin list'],
    summary: 'list the profile\'s bundles: enabled, disabled, available',
    details:
      'Enabled = running; disabled = installed but deselected; available = shipped or cataloged but not selected. `/plugin info <name>` explains one.',
    surfaces: ['control'],
    group: 'plugins',
  },
  {
    path: 'plugin info',
    usage: '/plugin info <name>',
    summary: 'one bundle in detail: version, source, rows, errors',
    details: '`<name>` matches the package name, its scope-less suffix, or its display title.',
    examples: ['/plugin info dsh-telegram-connector'],
    surfaces: ['control'],
    group: 'plugins',
  },
  {
    path: 'plugin add',
    usage: '/plugin add <spec>',
    aliases: ['/plugin install'],
    summary: 'inspect a package, then install it after confirmation',
    details:
      'The spec is a registry name (`pkg`, `pkg@1.2`), `github:owner/repo`, an absolute path or a tarball URL. Nothing mutates until `/plugin confirm`. A confirmation opens a rollback trial: live under HMR, or around a restart.',
    examples: [
      '/plugin add github:owner/repo',
      '/plugin add /data/workspace/hello-plugin',
      '/plugin add some-package@1.2.3',
    ],
    surfaces: ['control'],
    group: 'plugins',
  },
  {
    path: 'plugin remove',
    usage: '/plugin remove <name>',
    aliases: ['/plugin rm'],
    summary: 'uninstall a bundle (confirmation + trial)',
    details:
      'The connector refuses to remove itself. Removing a bundle that is running may need a restart, which the trial performs.',
    surfaces: ['control'],
    group: 'plugins',
  },
  {
    path: 'plugin enable',
    usage: '/plugin enable <name>',
    summary: 'select a bundle',
    details: 'Confirms first, then applies live under HMR or restarts into a trial.',
    surfaces: ['control'],
    group: 'plugins',
  },
  {
    path: 'plugin disable',
    usage: '/plugin disable <name>',
    summary: 'deselect a bundle, keeping the package installed',
    details: 'Confirms first. The connector refuses to disable itself.',
    surfaces: ['control'],
    group: 'plugins',
  },
  {
    path: 'plugin confirm',
    usage: '/plugin confirm',
    summary: 'run the pending plugin action',
    details:
      'Pending actions expire after 10 minutes and are bound to the user who started them. `/plugin cancel` drops one.',
    surfaces: ['control'],
    group: 'plugins',
  },
  {
    path: 'plugin cancel',
    usage: '/plugin cancel',
    summary: 'drop the pending plugin action',
    surfaces: ['control'],
    group: 'plugins',
  },
  {
    path: 'plugin approve',
    usage: '/plugin approve',
    summary: 'allow the install scripts pnpm blocked, then retry',
    details:
      'Only appears after a failed install lists blocked packages. It allows exactly those names, with the host user\'s permissions.',
    surfaces: ['control'],
    group: 'plugins',
  },
  {
    path: 'system',
    usage: '/system <status|restart|update|confirm|rollback>',
    summary: 'runtime lifecycle: status, restarts, connector and setup updates',
    details:
      'One namespace for profile-global operations. `status` shows versions and the supervisor; `restart` and `update connector` default to a trial, `now` skips it; `update all` checks the host-side setup update; `confirm` and `rollback` close the current trial.',
    examples: ['/system status', '/system restart now', '/system update connector'],
    surfaces: ['control'],
    group: 'system',
  },
  {
    path: 'system status',
    usage: '/system status',
    summary: 'connector, DSH and supervisor state',
    details: 'Includes the open trial, its deadline and the agent preset/tool availability indirectly through `/about`.',
    surfaces: ['control'],
    group: 'system',
  },
  {
    path: 'system restart',
    usage: '/system restart [now]',
    summary: 'restart the runtime; default is a trial with a rollback window',
    details:
      'With no argument it restarts into a trial: commit with `/system confirm`, revert with `/system rollback`, or let it expire. `now` restarts immediately and makes the current state the rollback point.',
    examples: ['/system restart', '/system restart now'],
    surfaces: ['control'],
    group: 'system',
  },
  {
    path: 'system update connector',
    usage: '/system update connector [now]',
    summary: 'reinstall the connector from its pinned ref',
    details:
      'The supervisor stops the runtime, runs the entrypoint reset-plugin (allow-builds and compatibility handling included), and starts it into a trial. `now` skips the trial and makes the new state the rollback point. A failed reinstall restores the previous state.',
    examples: ['/system update connector', '/system update connector now'],
    surfaces: ['control'],
    group: 'system',
  },
  {
    path: 'system update all',
    usage: '/system update all [--i-know-versions-are-incompatible]',
    summary: 'drain sessions, then update setup through the updater sidecar',
    details:
      'Blocks new requests, waits until every agent (web UI and Telegram) is idle, then asks the updater to apply the latest compatible setup tag. Crossing a product major or DSH line requires the explicit flag. If the updater token is empty, this only prints the host commands.',
    surfaces: ['control'],
    group: 'system',
  },
  {
    path: 'system confirm',
    usage: '/system confirm',
    summary: 'commit the open trial',
    details: 'The Commit button on the trial message does the same. The committed state becomes the new rollback point.',
    surfaces: ['control'],
    group: 'system',
  },
  {
    path: 'system rollback',
    usage: '/system rollback',
    summary: 'restore the last committed state and restart',
    details: 'Also available as the Roll back button. Sessions and workspace files are untouched.',
    surfaces: ['control'],
    group: 'system',
  },
  {
    path: 'timezone',
    usage: '/timezone [zone]',
    summary: 'zone used to read times you type',
    details:
      'Display is client-side: deadlines and reminders are Telegram `<tg-time>` and render in your own zone. Input needs one zone, which is this value (default `$DSH_TIMEZONE` or UTC).',
    examples: ['/timezone', '/timezone Europe/Minsk'],
    surfaces: ['control'],
    group: 'time',
  },
  {
    path: 'status',
    usage: '/status [session]',
    summary: 'runtime state; on the dashboard, one session\'s state',
    details:
      'In the bot chat it reports the model route, counts, poller, timezone and supervisor. On the dashboard, `/status <session>` adds that session\'s id, topic, model and agent state.',
    surfaces: ['control', 'dashboard'],
    group: 'runtime',
  },
  {
    path: 'about',
    usage: '/about',
    summary: 'versions and the DSH compatibility range',
    details: 'Connector version, runtime version when detectable, and which DSH releases this connector supports.',
    surfaces: ['control'],
    group: 'runtime',
  },
  {
    path: 'schedules',
    usage: '/schedules',
    summary: 'automation surface — not implemented yet',
    details: 'The scheduled-job surface lands after the plugin surface.',
    surfaces: ['control'],
    group: 'time',
  },

  // --- dashboard -----------------------------------------------------------
  {
    path: 'new',
    usage: '/new [title]',
    summary: 'mint a session and create its topic',
    details: 'Sessions are not created inside a session topic: one topic is always one session.',
    surfaces: ['dashboard'],
    group: 'sessions',
  },
  {
    path: 'sessions',
    usage: '/sessions',
    summary: 'the workspace dashboard: path, workspace id, sessions',
    surfaces: ['dashboard'],
    group: 'sessions',
  },
  {
    path: 'setsystem',
    usage: '/setsystem',
    summary: 'make this empty topic the command surface',
    details:
      'Only a topic with no session can claim the role, which is how a hand-made empty topic becomes the dashboard instead of General.',
    surfaces: ['dashboard'],
    group: 'sessions',
  },
  {
    path: 'sync',
    usage: '/sync',
    summary: 'adopt sessions created in the web UI',
    details:
      'For each session: archived ones are skipped, an existing topic is probed and kept only if it answers, the rest get a topic and a replay of their last 20 messages. Safe to repeat.',
    surfaces: ['dashboard'],
    group: 'sessions',
  },
  {
    path: 'list archived',
    usage: '/list archived',
    summary: 'archived sessions, with whether a topic exists',
    surfaces: ['dashboard'],
    group: 'sessions',
  },
  {
    path: 'unarchive',
    usage: '/unarchive <id|all>',
    summary: 'restore archived sessions and give them topics',
    examples: ['/unarchive 0b6f', '/unarchive all'],
    surfaces: ['dashboard'],
    group: 'sessions',
  },
  {
    path: 'rename',
    usage: '/rename <session> <title>',
    summary: 'rename a session and its topic',
        surfaces: ['dashboard'],
    group: 'sessions',
  },
  {
    path: 'model',
    usage: '/model <session> <provider>/<model>',
    summary: 'set the model route for one session',
    details: 'Takes effect on the next turn. The session topic itself takes plain text only.',
    surfaces: ['dashboard'],
    group: 'sessions',
  },
  {
    path: 'close',
    usage: '/close <session>',
    summary: 'archive the session and close its topic',
    details: 'Reopen with `/reopen`. Closing the topic by hand does the same thing.',
    surfaces: ['dashboard'],
    group: 'sessions',
  },
  {
    path: 'reopen',
    usage: '/reopen <session>',
    summary: 'unarchive the session and reopen its topic',
    surfaces: ['dashboard'],
    group: 'sessions',
  },
  {
    path: 'forget',
    usage: '/forget <session>',
    summary: 'drop the topic→session binding',
    details: 'The session and the topic are left intact; the topic stops being a session.',
    surfaces: ['dashboard', 'session'],
    group: 'sessions',
  },
  {
    path: 'unbind',
    usage: '/unbind',
    summary: 'detach this group from the workspace',
    details: 'Deletes the group\'s session topics and clears the bindings. The workspace and its sessions stay in DSH.',
    surfaces: ['dashboard'],
    group: 'workspace',
  },
  {
    path: 'dangerous cleanup',
    usage: '/dangerous cleanup [confirm]',
    summary: 'delete known topics that are not sessions',
    details:
      'First call lists what it would delete; `/dangerous cleanup confirm` performs it. Telegram cannot list topics, so only topics this group has shown the bot are considered.',
    surfaces: ['dashboard'],
    group: 'sessions',
  },
]

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/^\/+/, '').replace(/\s+/g, ' ')
}

function canonical(input: string): string {
  const key = normalize(input)
  return ALIASES[key] ?? key
}

function groupRank(group: string): number {
  const index = GROUP_ORDER.indexOf(group)
  return index === -1 ? GROUP_ORDER.length : index
}

function available(doc: CommandDoc, surface: Surface): boolean {
  return doc.surfaces.includes(surface)
}

function docsFor(surface: Surface): CommandDoc[] {
  return COMMANDS
    .filter((doc) => available(doc, surface))
    .sort((left, right) => groupRank(left.group) - groupRank(right.group) || left.path.localeCompare(right.path))
}

function title(doc: CommandDoc): string {
  return `\`${doc.usage}\``
}

function availability(doc: CommandDoc, surface: Surface): string {
  if (available(doc, surface)) return ''
  const rooms = doc.surfaces.map((entry) => (entry === 'control' ? 'the bot chat' : entry === 'dashboard' ? 'the system topic' : 'a session topic'))
  return `\n_available in ${rooms.join(' and ')}._`
}

function renderDoc(doc: CommandDoc, surface: Surface): string {
  const lines = [`**${title(doc)}**`, doc.summary]
  if (doc.details !== undefined) lines.push('', doc.details)
  if (doc.aliases !== undefined && doc.aliases.length > 0) {
    lines.push('', `aliases: ${doc.aliases.map((alias) => `\`${alias}\``).join(' · ')}`)
  }
  if (doc.examples !== undefined && doc.examples.length > 0) {
    lines.push('', ...doc.examples.map((example) => `· \`${example}\``))
  }
  const note = availability(doc, surface)
  if (note.length > 0) lines.push(note)
  return lines.join('\n')
}

function renderDocList(docs: CommandDoc[], surface: Surface): string {
  return docs.map((doc) => renderDoc(doc, surface)).join('\n\n')
}

/** `/help`: commands grouped by area, with one line each. */
export function indexText(surface: Surface): string {
  const docs = docsFor(surface)
  const groups = new Map<string, CommandDoc[]>()
  for (const doc of docs) {
    const list = groups.get(doc.group) ?? []
    list.push(doc)
    groups.set(doc.group, list)
  }
  const lines = [
    `**commands · ${surface === 'control' ? 'bot chat' : surface === 'dashboard' ? 'workspace dashboard' : 'session topic'}**`,
    `_${SURFACE_NOTE[surface]}_`,
    '',
    '`/help <command>` or `<command> --help` for details · `/man` for the full manual',
  ]
  for (const group of [...groups.keys()].sort((a, b) => groupRank(a) - groupRank(b))) {
    lines.push('', `**${group}**`)
    for (const doc of groups.get(group) ?? []) {
      lines.push(`· ${title(doc)} — ${doc.summary}`)
    }
  }
  if (surface === 'control') {
    lines.push('', '_The group dashboard has its own commands: `/new`, `/sync`, `/sessions`, `/close`, …_')
  } else if (surface === 'dashboard') {
    lines.push('', '_Plugin, restart and update commands live in the bot chat._')
  }
  return lines.join('\n')
}

/** `/man`: the same registry with details and examples. */
export function manualText(surface: Surface, only?: string): string {
  const docs = docsFor(surface)
  if (only !== undefined) return renderDocList(docs.filter((doc) => doc.path.startsWith(only)), surface)
  const groups = new Map<string, CommandDoc[]>()
  for (const doc of docs) {
    const list = groups.get(doc.group) ?? []
    list.push(doc)
    groups.set(doc.group, list)
  }
  const lines = [
    `**manual · ${surface === 'control' ? 'bot chat' : surface === 'dashboard' ? 'workspace dashboard' : 'session topic'}**`,
    `_${SURFACE_NOTE[surface]}_`,
    '',
    'arguments: `<required>`, `[optional]`, `<a|b>` choose one. Every command accepts `--help`.',
  ]
  for (const group of [...groups.keys()].sort((a, b) => groupRank(a) - groupRank(b))) {
    lines.push('', `# ${group}`)
    for (const doc of groups.get(group) ?? []) {
      lines.push('', `**${doc.usage}**`, doc.summary)
      if (doc.details !== undefined) lines.push(doc.details)
      if (doc.aliases !== undefined && doc.aliases.length > 0) {
        lines.push(`aliases: ${doc.aliases.map((alias) => `\`${alias}\``).join(' · ')}`)
      }
      if (doc.examples !== undefined && doc.examples.length > 0) {
        lines.push(...doc.examples.map((example) => `· \`${example}\``))
      }
    }
  }
  return lines.join('\n')
}

/** `/help <command>` and `<command> --help`. */
export function lookupText(raw: string, surface: Surface): string | undefined {
  const key = canonical(raw)
  if (key.length === 0) return indexText(surface)
  const exact = COMMANDS.find((doc) => doc.path === key || doc.aliases?.some((alias) => canonical(alias) === key))
  if (exact !== undefined) return renderDoc(exact, surface)
  const children = COMMANDS.filter((doc) => doc.path.startsWith(`${key} `))
  if (children.length > 0) return renderDocList(children, surface)
  return undefined
}

export function unknownHelp(target: string): string {
  const cleaned = target.trim().replace(/^\/+/, '')
  return cleaned.length === 0
    ? 'no help target given — `/help` lists commands.'
    : `no help for \`/${cleaned}\` — \`/help\` lists what exists here.`
}

/** `--help` / `-h` anywhere in the arguments. */
export function hasHelpFlag(args: readonly string[]): boolean {
  return args.some((arg) => arg === '--help' || arg === '-h')
}

/** Strip the help flag so the remaining words address a command. */
export function stripHelpFlag(args: readonly string[]): string[] {
  return args.filter((arg) => arg !== '--help' && arg !== '-h')
}
