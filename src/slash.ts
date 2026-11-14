/**
 * Parsing and normalization for session-topic slash messages.
 *
 * DSH commands use the same syntax as the Web composer: a lowercase name with
 * letters, digits, `_` or `-`, then end-of-input or whitespace. Only the first
 * non-whitespace character can start a command; a slash anywhere later is
 * ordinary text. Connector commands keep precedence; everything else is offered
 * to the host command registry, then to the user-invocable skill catalog.
 *
 * @module dsh-telegram-connector/slash
 */

export interface ParsedSlash {
  name: string
  args: string
}

export interface NormalizedSlashInput {
  /** Command-like input has leading whitespace removed; ordinary prompts are unchanged. */
  text: string
  /** True when the command was addressed to a different known bot. */
  directedElsewhere: boolean
}

/** Command names owned by the connector, which must keep their current behavior. */
export const RESERVED_CONNECTOR_COMMANDS: ReadonlySet<string> = new Set([
  'archived',
  'bind',
  'cleanup',
  'close',
  'commands',
  'dangerous',
  'firewall',
  'forget',
  'help',
  'man',
  'model',
  'new',
  'plugin',
  'plugins',
  'reactions',
  'rename',
  'reopen',
  'restart',
  'rollback',
  'run',
  'sessions',
  'dashboard',
  'skill',
  'skills',
  'start',
  'status',
  'sync',
  'system',
  'timezone',
  'unarchive',
  'unbind',
  'update',
  'workspace',
  'workspaces',
])

/** Parse a slash message using the host command grammar. */
export function parseSlash(text: string): ParsedSlash | undefined {
  const match = /^\/([a-z0-9_-]+)(?=\s|$)/.exec(text.trimStart())
  if (match === null) return undefined
  const name = match[1]
  if (name === undefined) return undefined
  const trimmed = text.trimStart()
  return { name, args: trimmed.slice(match[0].length).trim() }
}

/**
 * Trim leading whitespace and remove a single `@bot` suffix from the command
 * token. A command addressed to another known bot is reported so the caller can
 * ignore it instead of executing it locally.
 */
export function normalizeSlashInput(text: string, botUsername?: string): NormalizedSlashInput {
  const trimmed = text.trimStart()
  const match = /^\/([a-z0-9_-]+)@([A-Za-z0-9_]+)(?=\s|$)/.exec(trimmed)
  // A slash at the first non-whitespace position is command syntax even when it
  // is malformed (`/etc/hosts`), so keep the trimmed form for the caller to
  // reject. Ordinary prompts keep their leading whitespace.
  if (match === null) {
    return { text: trimmed.startsWith('/') ? trimmed : text, directedElsewhere: false }
  }
  const [, name, addressedTo] = match
  if (
    botUsername !== undefined &&
    addressedTo !== undefined &&
    addressedTo.toLowerCase() !== botUsername.toLowerCase()
  ) {
    return { text: trimmed, directedElsewhere: true }
  }
  return {
    text: `/${name ?? ''}${trimmed.slice(match[0].length)}`,
    directedElsewhere: false,
  }
}

/**
 * Remove one leading slash from an escaped prompt. Only a leading `//` is an
 * escape; slashes later in the text are never touched.
 */
export function unescapeLeadingSlash(text: string): { text: string; escaped: boolean } {
  if (!text.startsWith('//')) return { text, escaped: false }
  return { text: text.slice(1), escaped: true }
}

export function isReservedConnectorCommand(name: string): boolean {
  return RESERVED_CONNECTOR_COMMANDS.has(name)
}

/**
 * Commands that stay reachable while an update is pending.
 *
 * The gate used to block every message except `/system status`, which included
 * the commands that clear a stuck drain and the restart that releases a held
 * session — the bot looked dead with no way out from Telegram. Everything here
 * is read-only or a documented recovery path; anything that starts work (a new
 * session, a plugin change, an update) stays blocked.
 */
const ALLOWED_SUBCOMMANDS = /^\/system\s+(?:status|cancel|restart|confirm|rollback)(?:\s|$)/

export function allowedDuringUpdate(text: string): boolean {
  const command = text.trim()
  // `/system` on its own is `/system status`; `/system update setup` is not.
  if (command === '/system') return true
  if (ALLOWED_SUBCOMMANDS.test(command)) return true
  return /^\/(?:about|help|man|start)(?:\s|$)/.test(command)
}
