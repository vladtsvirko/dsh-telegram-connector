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
  /** `true` = admin only; a string names the subcommand still open to everyone. */
  admin?: boolean | string
}

const GROUP_ORDER = ['start', 'workspace', 'sessions', 'plugins', 'system', 'runtime', 'time']

const ALIASES: Record<string, string> = {
  start: 'help',
  '?': 'help',
  'plugin list': 'plugins',
  'plugin install': 'plugin add',
  'plugin rm': 'plugin remove',
  'plugin del': 'plugin remove',
  'list archived': 'archived',
  list: 'archived',
  'workspace rm': 'workspace remove',
}

const SURFACE_NOTE: Record<Surface, string> = {
  control:
    'This chat is the control plane. Session commands live in a group\'s dashboard topic; each topic is one session.',
  dashboard:
    'This topic owns this group\'s workspace. Plugin, restart, update and timezone commands live in the bot chat.',
  session:
    'This topic is one session — plain text is a turn. Only a leading `/` starts a command; slashes later in the text are literal. `/commands` lists host commands, `/skills` lists user-invocable skills, `/run` bypasses connector names and `/skill` forces a skill. `//text` sends a message that starts with `/`. `/help` and `/man` work here too.',
}

export const COMMANDS: CommandDoc[] = [
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
    path: 'commands',
    usage: '/commands',
    summary: 'list the host slash commands available in this session',
    details:
      'Host commands run against the session without creating a model message. The list is read live, so a plugin that registers a command appears without a connector update. A file or photo sent with a command is staged for the next prompt; commands do not take attachments.',
    examples: ['/commands', '/run status'],
    surfaces: ['session'],
    group: 'start',
  },
  {
    path: 'skills',
    usage: '/skills',
    summary: 'list user-invocable skills and how to load them',
    details:
      'Run `/<name>` to load a user-invocable skill; the skill instructions are injected into that turn. The list is read live from the workspace skill catalog. Media sent with a skill is attached to that turn.',
    examples: ['/skills', '/skill telegram-rich-text', '/telegram-rich-text'],
    surfaces: ['session'],
    group: 'start',
  },
  {
    path: 'run',
    usage: '/run <command> [args]',
    summary: 'run a host command even when a connector command owns the name',
    details:
      'This is the escape hatch for name collisions. It only runs host commands, never a skill, and the output stays out of the model history. Media is staged for the next prompt.',
    examples: ['/run status', '/run compact now'],
    surfaces: ['session'],
    group: 'start',
  },
  {
    path: 'skill',
    usage: '/skill <name> [args]',
    summary: 'load a user-invocable skill even when a host command owns the name',
    details:
      'This is the escape hatch for host-command vs skill collisions. It only loads skills, never a host command. Media and reply references are attached to the skill turn.',
    examples: ['/skill telegram-rich-text', '/skill status'],
    surfaces: ['session'],
    group: 'start',
  },
  {
    path: 'workspaces',
    usage: '/workspaces',
    summary: 'list workspaces, their group, and the link (only for a workspace with no group yet)',
    details: 'A workspace with no group gets a one-tap link that adds the bot to a new group.',
    surfaces: ['control'],
    group: 'workspace',
  },
  {
    path: 'workspace new',
    admin: true,
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
    admin: true,
    usage: '/workspace link <name>',
    summary: 'print the startgroup link again',
    details: '`<name>` matches the workspace id, a prefix, its title or its path basename.',
    surfaces: ['control'],
    group: 'workspace',
  },
  {
    path: 'workspace remove',
    usage: '/workspace remove <name>',
    aliases: ['/workspace rm'],
    summary: 'unregister a workspace and clear its group',
    details:
      'Shows how many session topics will be deleted, then asks for confirmation. Removes the workspace from DSH and deletes the binding; the directory, the sessions and the group itself are untouched.',
    surfaces: ['control'],
    group: 'workspace',
    admin: true,
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
    admin: true,
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
    admin: true,
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
    admin: true,
    usage: '/plugin enable <name>',
    summary: 'select a bundle',
    details: 'Confirms first, then applies live under HMR or restarts into a trial.',
    surfaces: ['control'],
    group: 'plugins',
  },
  {
    path: 'plugin disable',
    admin: true,
    usage: '/plugin disable <name>',
    summary: 'deselect a bundle, keeping the package installed',
    details: 'Confirms first. The connector refuses to disable itself.',
    surfaces: ['control'],
    group: 'plugins',
  },
  {
    path: 'plugin confirm',
    admin: true,
    usage: '/plugin confirm',
    summary: 'run the pending plugin action',
    details:
      'Pending actions expire after 10 minutes and are bound to the user who started them. `/plugin cancel` drops one.',
    surfaces: ['control'],
    group: 'plugins',
  },
  {
    path: 'plugin cancel',
    admin: true,
    usage: '/plugin cancel',
    summary: 'drop the pending plugin action',
    surfaces: ['control'],
    group: 'plugins',
  },
  {
    path: 'plugin approve',
    admin: true,
    usage: '/plugin approve',
    summary: 'allow the install scripts pnpm blocked, then retry',
    details:
      'Only appears after a failed install lists blocked packages. It allows exactly those names, with the host user\'s permissions.',
    surfaces: ['control'],
    group: 'plugins',
  },
  {
    path: 'system',
    usage: '/system <status|restart|update|confirm|rollback|cancel|components|takechat>',
    admin: '`status`',
    summary: 'runtime lifecycle: status, restarts, connector and setup updates, optional components',
    details:
      'One namespace for profile-global operations. `status` shows versions and the supervisor; `restart` and every `update` default to a trial, `now` skips it. `update connector` moves the connector to its newest compatible version; `update penpot` (or `update plugin <name>`) does the same for another bundle through the plugin manager; `update setup` posts a confirmation card, then drains agents and moves the setup checkout through the updater service. Plugin versions are independent of the setup tag. `confirm` and `rollback` close the profile trial; rollback does not move the checkout or the DSH install. `components` lists optional components with Enable/Disable/Port buttons; the updater applies them and restarts the runtime.',
    examples: ['/system status', '/system restart now', '/system update connector'],
    surfaces: ['control'],
    group: 'system',
  },
  {
    path: 'firewall',
    usage: '/firewall [allow <port>]',
    summary: 'check whether ufw lets the web UI through, and allow it from here',
    details:
      'The runtime is a systemd service, so ufw gates it directly. Reads the ports the deployment serves from its .env and names the network from the interface carrying DSH_BIND_IP. `allow <port>` is admin only and accepts only a port this deployment already serves — the updater runs the fixed `ufw allow from <network> to any port <port> proto tcp`, never a command from the chat.',
    examples: ['/firewall', '/firewall allow 4310'],
    surfaces: ['control'],
    group: 'system',
  },
  {
    path: 'system takechat',
    admin: true,
    usage: '/system takechat',
    summary: 'make this private chat the control chat',
    details:
      'Notices, update reports and failure cards go to the control chat. It is set on the first private chat you use and does not follow later DMs; this command moves it deliberately. Admin only.',
    examples: ['/system takechat'],
    surfaces: ['control'],
    group: 'system',
  },
  {
    path: 'system components',
    admin: true,
    usage: '/system components [<component> <enable|disable|port> [<port>]]',
    summary: 'optional components: list, enable, disable, change the port',
    details:
      'No argument posts a card with one row per component (Enable/Disable and Port). The updater starts or stops the stack on the host and restarts the runtime so the tools follow; it reports the result in this chat. The text form is for precision, for example /system components design port 8091. Needs DSH_UPDATER_TOKEN; without it the card explains what is missing.',
    examples: ['/system components', '/system components design enable', '/system components design port 8091'],
    surfaces: ['control'],
    group: 'system',
  },
  {
    path: 'system status',
    usage: '/system status',
    summary: 'connector, DSH and supervisor state',
    details:
      'Includes the open trial, its deadline and the agent preset/tool availability directly through `/system status`. The `registry` line compares the workspaces the runtime lists with the ones bound to Telegram (a gap is what makes the web UI look empty while the bot still knows them), and the `data` line names a second runtime holding the same data directory.',
    surfaces: ['control'],
    group: 'system',
  },
  {
    path: 'system restart',
    admin: true,
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
    admin: true,
    usage: '/system update connector [to <version>] [now]',
    summary: 'move the connector to its newest compatible version',
    details:
      'Resolves the newest npm version (or the repository tag for a git install, or the exact `to <version>`), checks its declared DSH range against this runtime, then asks the supervisor to stop the runtime and run the entrypoint reset-plugin into that spec. The new version comes up in a trial; `now` skips the trial and makes the restarted state the rollback point. A failed install or an unhealthy boot restores the previous state. The setup tag is no longer involved: connector and setup versions move independently.',
    examples: ['/system update connector', '/system update connector to v0.13.1', '/system update connector now'],
    surfaces: ['control'],
    group: 'system',
  },
  {
    path: 'system update penpot',
    admin: true,
    usage: '/system update penpot [to <version>] [now]',
    summary: 'move the Penpot plugin to its newest compatible version',
    details:
      'Resolves the newest version for the installed Penpot bundle, opens a rollback trial, removes the old package and installs the new one through the host plugin manager. If the install fails, the previous version is put back at once; if that also fails, the supervisor restores the pre-update profile. The `dsh-penpot` row configuration is untouched. `/system update plugin <name>` does the same for any npm- or GitHub-installed bundle.',
    examples: ['/system update penpot', '/system update penpot to v0.3.1'],
    surfaces: ['control'],
    group: 'system',
  },
  {
    path: 'system update plugin',
    admin: true,
    usage: '/system update plugin <name> [to <version>] [now]',
    summary: 'update any GitHub-installed bundle through the plugin manager',
    details:
      'The generic form of `update penpot`. The bundle must record an npm or GitHub source; linked and installation-supplied bundles are reported as host-managed. The connector refuses to remove itself here — use `update connector`, which goes through the supervisor. Plugin versions are independent of the setup tag.',
    examples: ['/system update plugin dsh-penpot-plugin', '/system update plugin dsh-penpot-plugin to v0.3.1'],
    surfaces: ['control'],
    group: 'system',
  },
  {
    path: 'system update setup',
    admin: true,
    usage: '/system update setup [--i-know-versions-are-incompatible]',
    summary: 'confirm, then drain sessions and update the setup',
    details:
      'Posts a card with the current and target version and the number of running sessions. **Update now** starts the drain; nothing happens before that. Once every agent (web UI and Telegram) is idle, the updater checks out the latest compatible setup tag, installs the matching DSH and connector, and restarts. Crossing a product major or DSH line requires the explicit flag. The card loses its Cancel button when the updater accepts; a failed health gate rolls back automatically. If the updater token is empty, this only prints the host commands.',
    surfaces: ['control'],
    group: 'system',
  },
  {
    path: 'system confirm',
    admin: true,
    usage: '/system confirm',
    summary: 'commit the open trial',
    details: 'The Commit button on the trial message does the same. The committed state becomes the new rollback point.',
    surfaces: ['control'],
    group: 'system',
  },
  {
    path: 'system rollback',
    admin: true,
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
      'In the bot chat it reports the model route, counts, poller, timezone and supervisor. On the dashboard it summarises the workspace (session count, model route, poller, timezone); `/status <session>` adds that session\'s id, topic, model and agent state. `/sessions` lists the workspace\'s sessions.',
    surfaces: ['control', 'dashboard'],
    group: 'runtime',
  },
  {
    path: 'web',
    usage: '/web',
    summary: 'a signed link into the web UI — the same sessions from a browser',
    details:
      'Prints a link that signs the browser in, so treat it like a password. The web UI shares the sessions: opening a topic there and sending a prompt hands that session over, and Telegram prompts are refused until it is released with `/system restart now`. Sent only in the bot chat, never in a group.',
    examples: ['/web'],
    surfaces: ['control'],
    group: 'runtime',
  },
  {
    path: 'reactions',
    usage: '/reactions [read|streaming|staged|on|off|reset|allowed] [emoji]',
    summary: 'read, streaming and staged-media reactions on Telegram messages',
    details:
      'The read reaction is set on your prompt once the bot reads it; the streaming reaction is set on a reply while it is still being edited and removed when the turn ends; the staged reaction marks media waiting for a caption or text prompt and is removed once used. Values are saved in the bindings and apply without a restart. Telegram only accepts its own reaction emoji — `/reactions allowed` lists them; `off` disables one slot.',
    examples: [
      '/reactions',
      '/reactions read 👀',
      '/reactions streaming ✍',
      '/reactions staged 🙉',
      '/reactions off',
      '/reactions reset',
    ],
    surfaces: ['control'],
    group: 'runtime',
  },
  {
    path: 'schedules',
    usage: '/schedules',
    summary: 'planned — not implemented yet',
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
    path: 'dashboard',
    admin: true,
    usage: '/dashboard',
    summary: 'make this empty topic the command surface',
    details:
      'Only a topic with no session can claim the role, which is how a hand-made empty topic becomes the dashboard instead of General. In the bot chat the same command posts a control card with buttons for status, the web link, update, restart, plugins and components.',
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
    path: 'archived',
    usage: '/archived',
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
    surfaces: ['dashboard'],
    group: 'sessions',
  },
  {
    path: 'bind',
    admin: true,
    usage: '/bind <workspace id or title>',
    summary: 'attach this group to a workspace (the startgroup link does the same)',
    details:
      'One group hosts one workspace, and one workspace lives in one group. The workspace must exist and be unclaimed; moving a workspace here clears the old group\'s bindings but leaves its conversation history. Only the admin can attach a group.',
    examples: ['/bind landing-page', '/bind 9cb8f1a2…'],
    surfaces: ['dashboard'],
    group: 'workspace',
  },
  {
    path: 'unbind',
    admin: true,
    usage: '/unbind',
    summary: 'detach this group from the workspace',
    details: 'Deletes the group\'s session topics and clears the bindings. The workspace and its sessions stay in DSH.',
    surfaces: ['dashboard'],
    group: 'workspace',
  },
  {
    path: 'dangerous cleanup',
    admin: true,
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
  const rooms = doc.surfaces.map((entry) => (entry === 'control' ? 'the bot chat' : entry === 'dashboard' ? 'the dashboard topic' : 'a session topic'))
  return `\n_available in ${rooms.join(' and ')}._`
}

function renderDoc(doc: CommandDoc, surface: Surface): string {
  const admin = doc.admin === undefined
    ? ''
    : doc.admin === true ? ' · requires admin' : ` · admin (except ${doc.admin})`
  const lines = [`**${title(doc)}**`, doc.summary + admin]
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
      const admin = doc.admin === undefined
        ? ''
        : doc.admin === true ? ' · admin' : ` · admin (except ${doc.admin})`
      lines.push(`· ${title(doc)} — ${doc.summary}${admin}`)
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
      const admin = doc.admin === undefined
        ? ''
        : doc.admin === true ? ' · requires admin' : ` · admin (except ${doc.admin})`
      lines.push('', `**${doc.usage}**`, doc.summary + admin)
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

export interface MenuEntry {
  /** Telegram command name: 1–32 characters, no slash. */
  command: string
  /** One line, shown under the command in the menu. */
  description: string
}

/**
 * The command menu Telegram shows above the input box.
 *
 * Built from the same registry as `/help`, so the menu cannot drift from the
 * manual. Telegram rejects names longer than 32 characters, descriptions longer
 * than 256, and more than 100 entries; subcommands (`system components`) cannot be
 * menu entries at all, so only the top-level names appear.
 *
 * @param scope - `private` for the bot chat, `group` for workspace groups.
 * @returns entries in registry order, ready for `setMyCommands`.
 */
export function commandMenu(scope: 'private' | 'group'): MenuEntry[] {
  const seen = new Set<string>()
  const entries: MenuEntry[] = []
  for (const doc of COMMANDS) {
    if (doc.path.includes(' ')) continue
    const shown = scope === 'private'
      ? doc.surfaces.includes('control')
      : doc.surfaces.some((surface) => surface === 'dashboard' || surface === 'session')
    if (!shown) continue
    const command = doc.path.replace(/^\/+/, '').slice(0, 32)
    if (command.length === 0 || seen.has(command)) continue
    seen.add(command)
    const admin = doc.admin === undefined
      ? ''
      : doc.admin === true ? ' · admin' : ` · admin (except ${doc.admin})`
    entries.push({ command, description: (doc.summary + admin).slice(0, 256) })
  }
  return entries.slice(0, 100)
}
