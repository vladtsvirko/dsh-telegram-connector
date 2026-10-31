/**
 * Human-facing process rows for tool calls, commands and skill loads.
 *
 * Telegram must stay readable: a tool call becomes one short row with a safe
 * preview, never its raw result. In `live` mode the connector edits one card
 * during the turn and finalises it collapsed; `summary` sends only the collapsed
 * summary after the turn. Web-UI-driven sessions follow the same mode.
 *
 * @module dsh-telegram-connector/process
 */

export type ProcessMode = 'off' | 'summary' | 'live'
export type ProcessStatus = 'running' | 'done' | 'error'
export type ProcessKind = 'tool' | 'command' | 'skill'

export interface ProcessItem {
  /** Correlation key: `tool:<callId>`, `command:<commandId>` or `skill:<seq>`. */
  readonly id: string
  readonly kind: ProcessKind
  readonly label: string
  readonly status: ProcessStatus
  /** Short safe error reason; never a full tool result. */
  readonly detail?: string
}

const MAX_PREVIEW = 120
const MAX_LINES = 20

function textArgument(args: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = args?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function parseArguments(raw: string | undefined): Record<string, unknown> | undefined {
  if (raw === undefined || raw.trim().length === 0) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

/** Redact common credential shapes without changing the rest of the text. */
export function redactSecrets(text: string): string {
  return text
    .replace(/((?:token|secret|password|passwd|api[_-]?key)\s*[=:]\s*)\S+/gi, '$1<redacted>')
    .replace(/(--(?:token|password|secret|api-key)\s+)\S+/gi, '$1<redacted>')
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer <redacted>')
    .replace(/\/\/[^/\s]+@/g, '//<redacted>@')
}

/** Redact and keep a short single-line preview. */
export function redactPreview(text: string, limit = MAX_PREVIEW): string {
  const redacted = redactSecrets(text)
    .replace(/\s+/g, ' ')
    .trim()
  return redacted.length <= limit ? redacted : `${redacted.slice(0, limit - 1)}…`
}

function pathPreview(value: string | undefined): string {
  return value === undefined ? '' : redactPreview(value)
}

/** A short row label for one tool call. */
export function toolLabel(name: string, argumentsJson?: string): string {
  const args = parseArguments(argumentsJson)
  const lower = name.toLowerCase()

  if (lower === 'skill') {
    return `🧠 Skill: ${textArgument(args, 'name') ?? 'unknown'}`
  }
  if (lower === 'bash' || lower === 'shell') {
    const command = textArgument(args, 'command') ?? textArgument(args, 'cmd')
    return command === undefined ? `💻 ${name}` : `💻 ${redactPreview(command)}`
  }
  if (lower === 'read' || lower.endsWith('.read')) {
    const path = textArgument(args, 'path') ?? textArgument(args, 'file')
    return path === undefined ? '📖 Read' : `📖 Read: ${pathPreview(path)}`
  }
  if (lower === 'write' || lower.endsWith('.write')) {
    const path = textArgument(args, 'path') ?? textArgument(args, 'file')
    return path === undefined ? '✍️ Write' : `✍️ Write: ${pathPreview(path)}`
  }
  if (lower === 'edit' || lower.endsWith('.edit')) {
    const path = textArgument(args, 'path') ?? textArgument(args, 'file')
    return path === undefined ? '✏️ Edit' : `✏️ Edit: ${pathPreview(path)}`
  }
  if (lower === 'web_search') {
    const query = textArgument(args, 'query')
    return query === undefined ? '🌐 Search' : `🌐 Search: ${redactPreview(query, 80)}`
  }
  if (lower === 'web_fetch') {
    const url = textArgument(args, 'url')
    if (url === undefined) return '🌐 Fetch'
    try {
      return `🌐 Fetch: ${new URL(url).host}`
    } catch {
      return `🌐 Fetch: ${redactPreview(url, 80)}`
    }
  }
  if (lower === 'subagent' || lower === 'subagent_fork') {
    const description = textArgument(args, 'description') ?? textArgument(args, 'prompt')
    return description === undefined ? `🤖 ${name}` : `🤖 ${redactPreview(description, 80)}`
  }
  if (lower === 'grep' || lower === 'glob' || lower === 'ls') {
    const pattern = textArgument(args, 'pattern') ?? textArgument(args, 'path')
    return pattern === undefined ? `🔎 ${name}` : `🔎 ${name}: ${redactPreview(pattern, 80)}`
  }
  return `🔧 ${name}`
}

/** A short row label for one host command. */
export function commandLabel(name: string, args?: string): string {
  const suffix = args === undefined || args.trim().length === 0 ? '' : ` ${redactPreview(args, 80)}`
  return `⚡ /${name}${suffix}`
}

export function skillLabel(name: string): string {
  return `🧠 Skill: ${name}`
}

function statusPrefix(item: ProcessItem, live: boolean): string {
  if (item.status === 'error') return '⚠️'
  if (item.status === 'running' && live) return '⏳'
  return '•'
}

export function processLine(item: ProcessItem, live = false): string {
  const detail = item.detail === undefined ? '' : ` — ${item.detail}`
  return `${statusPrefix(item, live)} ${item.label}${detail}`
}

function visible(items: readonly ProcessItem[]): ProcessItem[] {
  if (items.length <= MAX_LINES) return [...items]
  const hidden = items.length - MAX_LINES
  return [...items.slice(0, MAX_LINES), {
    id: 'truncated',
    kind: 'tool',
    label: `… +${String(hidden)} more`,
    status: 'done',
  }]
}

/** The live “Working…” card used while a web-UI session runs. */
export function formatLiveProcess(items: readonly ProcessItem[]): string {
  const lines = visible(items).map((item) => processLine(item, true))
  return ['⚙️ Working…', ...lines].join('\n')
}

export interface ProcessSummaryOptions {
  /** Heading inside the collapsed summary; defaults to `Process`. */
  heading?: string
}

/** A collapsed process summary for rich Telegram messages. */
export function formatProcessSummary(
  items: readonly ProcessItem[],
  options: ProcessSummaryOptions = {},
): string {
  const count = items.length
  const lines = visible(items).map((item) => processLine(item, false))
  const heading = options.heading ?? 'Process'
  return [
    `<details><summary>${heading} · ${String(count)} step${count === 1 ? '' : 's'}</summary>`,
    '',
    ...lines,
    '',
    '</details>',
  ].join('\n')
}

/** Plain fallback when a rich message is unavailable. */
export function formatProcessSummaryText(
  items: readonly ProcessItem[],
  options: ProcessSummaryOptions = {},
): string {
  const count = items.length
  const heading = options.heading ?? 'Process'
  return [`${heading} · ${String(count)} step${count === 1 ? '' : 's'}`, ...visible(items).map((item) => processLine(item, false))].join('\n')
}
