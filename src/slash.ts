/**
 * Parsing for session-topic slash messages.
 *
 * DSH commands use the same syntax as the Web composer: a lowercase name with
 * letters, digits, `_` or `-`, then end-of-input or whitespace. Connector
 * commands keep precedence; everything else is offered to the host command
 * registry, then to the user-invocable skill catalog.
 *
 * @module dsh-telegram-connector/slash
 */

export interface ParsedSlash {
  name: string
  args: string
}

/** Command names owned by the connector, which must keep their current behavior. */
export const RESERVED_CONNECTOR_COMMANDS: ReadonlySet<string> = new Set([
  'about',
  'archived',
  'bind',
  'cleanup',
  'close',
  'commands',
  'dangerous',
  'forget',
  'help',
  'list',
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
  'schedules',
  'sessions',
  'setsystem',
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
  const match = /^\/([a-z0-9_-]+)(?=\s|$)/.exec(text)
  if (match === null) return undefined
  const name = match[1]
  if (name === undefined) return undefined
  return { name, args: text.slice(match[0].length).trim() }
}

export function isReservedConnectorCommand(name: string): boolean {
  return RESERVED_CONNECTOR_COMMANDS.has(name)
}
