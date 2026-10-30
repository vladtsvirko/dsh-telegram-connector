/**
 * Markdown → Telegram HTML, and message splitting.
 *
 * Telegram's classic HTML parse mode accepts only a small tag set (no tables,
 * headings or lists), so this module renders those block structures into a
 * readable fallback: a Markdown table becomes a monospaced `<pre>` table (or a
 * key/value list when it is too wide), and headings become bold lines.
 *
 * Rich messages (Bot API 10.1+) are different: Telegram parses Markdown itself
 * and renders tables natively. `toRichMarkdown` therefore only normalizes the
 * source; callers prefer it and fall back to `toTelegramHtml` when the API or
 * the content rejects rich messages.
 */

export const MAX_MESSAGE = 4096
/** Leave room for the tags a split can add (pre/code reopen). */
export const SAFE_LENGTH = 3800

/** Telegram's rich-message ceiling, kept here for callers that want the headroom. */
export const MAX_RICH_MESSAGE = 32768

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Rich messages are parsed by Telegram; only line endings need normalizing. */
export function toRichMarkdown(markdown: string): string {
  return markdown.replace(/\r\n?/g, '\n').replace(/\u0000/g, '')
}

type Mode = 'html' | 'plain'
type Align = 'left' | 'center' | 'right'

interface Table {
  header: string[]
  aligns: Align[]
  rows: string[][]
}

interface ProtectedTime {
  html: string
  plain: string
}

/**
 * Telegram renders `<tg-time>` in the reader's own timezone. It is the one tag
 * this renderer lets through; everything else is escaped. The fallback text is
 * what clients without support show.
 */
const TG_TIME = /<tg-time\s+unix="(\d{1,12})"(?:\s+format="([^"]*)")?\s*>([\s\S]*?)<\/tg-time>/g

function protectTimes(markdown: string): { text: string; tags: ProtectedTime[] } {
  const tags: ProtectedTime[] = []
  const text = markdown.replace(TG_TIME, (_match, unix: string, format: string | undefined, fallback: string) => {
    const resolved = format ?? ''
    if (resolved !== '' && !/^(r|w?[dD]?[tT]?)$/.test(resolved)) return fallback
    const attribute = resolved === '' ? '' : ` format="${resolved}"`
    tags.push({
      html: `<tg-time unix="${unix}"${attribute}>${escapeHtml(fallback)}</tg-time>`,
      plain: fallback,
    })
    return `\u0000TG${tags.length - 1}\u0000`
  })
  return { text, tags }
}

/** Convert a Markdown-ish string into the HTML subset Telegram accepts. */
export function toTelegramHtml(markdown: string): string {
  const protectedTimes = protectTimes(markdown)
  const body = renderBlocks(protectedTimes.text, 'html')
  return body.replace(/\u0000TG(\d+)\u0000/g, (_match, index: string) => protectedTimes.tags[Number(index)]?.html ?? '')
}

/**
 * Last-resort text for a send whose HTML was rejected. It deliberately contains
 * no Markdown markers and no Telegram tags, so a table cannot arrive as raw
 * `| a | b |` source.
 */
export function toPlainText(markdown: string): string {
  const protectedTimes = protectTimes(markdown)
  const body = renderBlocks(protectedTimes.text, 'plain')
  return body.replace(/\u0000TG(\d+)\u0000/g, (_match, index: string) => protectedTimes.tags[Number(index)]?.plain ?? '')
}

/** True when the text contains a Markdown table that plain HTML cannot express. */
export function hasTable(markdown: string): boolean {
  const lines = toRichMarkdown(markdown).split('\n')
  let inFence = false
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (isFenceStart(line)) {
      inFence = !inFence
      continue
    }
    if (!inFence && isTableStart(lines, index)) return true
  }
  return false
}

function renderBlocks(markdown: string, mode: Mode): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''

    if (line.trim().length === 0) {
      index += 1
      continue
    }

    if (isFenceStart(line)) {
      const fence = readFence(lines, index)
      out.push(renderCode(fence.code, fence.language, mode))
      index = fence.next
      continue
    }

    const table = readTable(lines, index)
    if (table !== undefined) {
      out.push(renderTable(table.table, mode))
      index = table.next
      continue
    }

    if (isHeading(line)) {
      out.push(renderHeading(line, mode))
      index += 1
      continue
    }

    if (isRule(line)) {
      out.push('─────')
      index += 1
      continue
    }

    if (isQuote(line)) {
      const quote: string[] = []
      while (index < lines.length && isQuote(lines[index] ?? '')) {
        quote.push((lines[index] ?? '').replace(/^\s*>\s?/, ''))
        index += 1
      }
      out.push(mode === 'html'
        ? `<blockquote>${inline(quote.join('\n'), mode)}</blockquote>`
        : quote.map((row) => `> ${plainInline(row)}`).join('\n'))
      continue
    }

    if (isListItem(line)) {
      const list: string[] = []
      while (index < lines.length) {
        const current = lines[index] ?? ''
        if (isListItem(current)) {
          list.push(current)
          index += 1
          continue
        }
        if (current.trim().length === 0) break
        // an indented continuation belongs to the previous item
        if (/^\s{2,}\S/.test(current) && list.length > 0 && !isBlockStart(lines, index)) {
          list[list.length - 1] = `${list[list.length - 1] ?? ''}\n${current}`
          index += 1
          continue
        }
        break
      }
      out.push(list.map((item) => renderListItem(item, mode)).join('\n'))
      continue
    }

    // paragraph: consume until a blank line or the next block-level construct
    const paragraph: string[] = []
    while (index < lines.length) {
      const current = lines[index] ?? ''
      if (current.trim().length === 0) break
      if (paragraph.length > 0 && isBlockStart(lines, index)) break
      paragraph.push(current)
      index += 1
    }
    if (paragraph.length > 0) out.push(inline(paragraph.join('\n'), mode))
  }

  return out.join('\n\n').trim()
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index] ?? ''
  return isFenceStart(line)
    || isHeading(line)
    || isRule(line)
    || isQuote(line)
    || isListItem(line)
    || isTableStart(lines, index)
}

const FENCE_START = /^```([\w+-]*)\s*$/

function isFenceStart(line: string): boolean {
  return FENCE_START.test(line)
}

function readFence(lines: string[], start: number): { code: string; language: string; next: number } {
  const language = FENCE_START.exec(lines[start] ?? '')?.[1] ?? ''
  const body: string[] = []
  let index = start + 1
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (/^```\s*$/.test(line)) {
      index += 1
      break
    }
    body.push(line)
    index += 1
  }
  return { code: body.join('\n'), language, next: index }
}

function renderCode(code: string, language: string, mode: Mode): string {
  if (mode === 'plain') return code
  const escaped = escapeHtml(code.replace(/\n$/, ''))
  return language.length > 0
    ? `<pre><code class="language-${escapeHtml(language)}">${escaped}</code></pre>`
    : `<pre>${escaped}</pre>`
}

const TABLE_SEPARATOR = /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)+\|?\s*$/

function isTableSeparator(line: string): boolean {
  return line.includes('|') && TABLE_SEPARATOR.test(line)
}

function isTableStart(lines: string[], index: number): boolean {
  const header = lines[index] ?? ''
  const separator = lines[index + 1] ?? ''
  return header.includes('|') && isTableSeparator(separator)
}

/** Split a table row on pipes, leaving escaped pipes and inline code alone. */
function splitTableRow(line: string): string[] {
  let text = line.trim()
  if (text.startsWith('|')) text = text.slice(1)
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1)

  const cells: string[] = []
  let current = ''
  let inCode = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? ''
    if (character === '\\' && text[index + 1] === '|') {
      current += '|'
      index += 1
      continue
    }
    if (character === '`') {
      inCode = !inCode
      current += character
      continue
    }
    if (character === '|' && !inCode) {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += character
  }
  cells.push(current.trim())
  return cells
}

function readTable(lines: string[], start: number): { table: Table; next: number } | undefined {
  if (!isTableStart(lines, start)) return undefined
  const header = splitTableRow(lines[start] ?? '')
  const separator = splitTableRow(lines[start + 1] ?? '')
  const aligns: Align[] = header.map((_cell, index) => {
    const marker = separator[index] ?? ''
    const left = marker.startsWith(':')
    const right = marker.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    return 'left'
  })

  const rows: string[][] = []
  let index = start + 2
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.trim().length === 0 || !line.includes('|') || isFenceStart(line)) break
    const cells = splitTableRow(line)
    rows.push(header.map((_cell, column) => cells[column] ?? ''))
    index += 1
  }
  return { table: { header, aligns, rows }, next: index }
}

function displayWidth(text: string): number {
  return [...text].length
}

function padCell(text: string, width: number, align: Align): string {
  const missing = Math.max(0, width - displayWidth(text))
  if (align === 'right') return `${' '.repeat(missing)}${text}`
  if (align === 'center') {
    const left = Math.floor(missing / 2)
    return `${' '.repeat(left)}${text}${' '.repeat(missing - left)}`
  }
  return `${text}${' '.repeat(missing)}`
}

/** Strip inline Markdown for a cell that is rendered inside `<pre>`. */
function stripInline(text: string): string {
  let out = text.replace(/`([^`\n]+)`/g, '$1')
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, url: string) => label === url ? url : label)
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '$1')
  out = out.replace(/__([^_\n]+)__/g, '$1')
  out = out.replace(/~~([^~\n]+)~~/g, '$1')
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1$2')
  out = out.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1$2')
  // A literal pipe inside a cell would read as a column separator in <pre>.
  return out.replace(/\|/g, '¦')
}

function renderTable(table: Table, mode: Mode): string {
  const columns = table.header.length
  if (columns === 0) return ''

  const plainCells = table.rows.map((row) => row.map((cell) => stripInline(cell)))
  const widths = table.header.map((cell, column) => {
    const bodyWidth = plainCells.reduce((max, row) => Math.max(max, displayWidth(row[column] ?? '')), 0)
    return Math.max(3, displayWidth(stripInline(cell)), bodyWidth)
  })
  const totalWidth = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, columns - 1) * 3

  if (columns > 6 || totalWidth > 48) return renderTableAsList(table, mode)

  const headerLine = table.header
    .map((cell, column) => padCell(stripInline(cell), widths[column] ?? 3, table.aligns[column] ?? 'left'))
    .join(' | ')
  const rule = widths.map((width) => '-'.repeat(width)).join('-+-')
  const body = plainCells.map((row) => row
    .map((cell, column) => padCell(cell, widths[column] ?? 3, table.aligns[column] ?? 'left'))
    .join(' | '))
  const aligned = [headerLine, rule, ...body].join('\n')
  // Padding can make a table larger than the Markdown source; the list fallback
  // is safer than a `<pre>` that no longer fits a Telegram message.
  if (aligned.length > 3400) return renderTableAsList(table, mode)
  return mode === 'html' ? `<pre>${escapeHtml(aligned)}</pre>` : aligned
}

function renderTableAsList(table: Table, mode: Mode): string {
  return table.rows.map((row) => {
    const first = row[0] ?? ''
    const rest = row.slice(1)
      .map((cell, index) => {
        if (cell.trim().length === 0) return ''
        const label = table.header[index + 1] ?? ''
        return label.length > 0 ? `${inline(label, mode)}: ${inline(cell, mode)}` : inline(cell, mode)
      })
      .filter((part) => part.length > 0)

    if (table.header.length === 1) {
      const value = inline(first, mode)
      return mode === 'html' ? `• ${value}` : `• ${value}`
    }
    const heading = inline(first, mode)
    const lead = mode === 'html' ? `<b>${heading.replace(/<\/?b>/g, '')}</b>` : heading
    return rest.length > 0 ? `${lead} — ${rest.join(' · ')}` : lead
  }).join('\n')
}

function isHeading(line: string): boolean {
  return /^#{1,6}\s+\S/.test(line)
}

function renderHeading(line: string, mode: Mode): string {
  const text = line.replace(/^#{1,6}\s+/, '')
  if (mode === 'plain') return plainInline(text)
  // The heading itself is bold; strip inner bold tags so the output is not nested.
  return `<b>${htmlInline(text).replace(/<\/?b>/g, '')}</b>`
}

function isRule(line: string): boolean {
  return /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)
}

function isQuote(line: string): boolean {
  return /^\s*>\s?/.test(line)
}

function isListItem(line: string): boolean {
  return /^\s*(?:[-*+]|\d+[.)])\s+\S/.test(line)
}

function renderListItem(line: string, mode: Mode): string {
  const match = /^(\s*)([-*+]|\d+[.)])\s+([\s\S]*)$/.exec(line)
  if (match === null) return inline(line, mode)
  const indent = '  '.repeat(Math.floor((match[1] ?? '').length / 2))
  const marker = match[2] ?? '-'
  const content = match[3] ?? ''
  const ordered = /^\d/.test(marker)
  const task = /^\[([ xX])\]\s+/.exec(content)
  const body = task === null ? content : content.replace(/^\[[ xX]\]\s+/, '')
  const bullet = task === null
    ? (ordered ? `${marker.replace(/[.)]$/, '')}.` : '•')
    : (task[1]?.toLowerCase() === 'x' ? '☑' : '☐')
  return `${indent}${bullet} ${inline(body, mode)}`
}

function inline(text: string, mode: Mode): string {
  return mode === 'plain' ? plainInline(text) : htmlInline(text)
}

function htmlInline(text: string): string {
  let out = escapeHtml(text)
  // inline code first: its content must not be touched by later rules
  out = out.replace(/`([^`\n]+)`/g, (_match, code: string) => `<code>${code}</code>`)
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label: string, url: string) => `<a href="${url}">${label}</a>`)
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
  out = out.replace(/__([^_\n]+)__/g, '<b>$1</b>')
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>')
  out = out.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>')
  out = out.replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
  return out
}

function plainInline(text: string): string {
  let out = text.replace(/`([^`\n]+)`/g, '$1')
  out = out.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_match, label: string, url: string) => label === url ? url : `${label} (${url})`,
  )
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '$1')
  out = out.replace(/__([^_\n]+)__/g, '$1')
  out = out.replace(/~~([^~\n]+)~~/g, '$1')
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1$2')
  out = out.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1$2')
  return out
}

/**
 * Split text into Telegram-sized chunks, preferring newline boundaries and
 * keeping fenced code blocks balanced. A split inside a Markdown table repeats
 * the header and separator, so every chunk still renders as a table.
 */
export function splitMessage(text: string, limit = SAFE_LENGTH): string[] {
  const normalized = text.replace(/\r\n?/g, '\n')
  if (normalized.length <= limit) return [normalized]

  const lines = normalized.split('\n')
  const chunks: string[] = []
  let current = ''
  let inFence = false
  let fenceLanguage = ''
  let inTable = false
  let tableHeader = ''
  let tableSeparator = ''
  let skipSeparatorOnce = false

  const push = (): void => {
    if (current.length === 0) return
    chunks.push(inFence ? `${current}\n\`\`\`` : current)
    current = inFence ? `\`\`\`${fenceLanguage}\n` : ''
  }

  /** Append a line, honouring a reopen prefix that already ends in a newline. */
  const place = (line: string): void => {
    if (current.length === 0) current = line
    else current = current.endsWith('\n') ? `${current}${line}` : `${current}\n${line}`
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''

    if (!inFence && !inTable && isTableStart(lines, index)) {
      inTable = true
      tableHeader = line
      tableSeparator = lines[index + 1] ?? ''
    }

    if (skipSeparatorOnce) {
      skipSeparatorOnce = false
      if (line === tableSeparator) {
        // the reopen prefix already contains the header and separator
        continue
      }
    }

    if (current.length + line.length + 1 > limit) {
      push()
      if (inTable && tableHeader.length > 0 && tableSeparator.length > 0) {
        const reopen = `${tableHeader}\n${tableSeparator}\n`
        if (reopen.length + line.length <= limit) {
          current = reopen
          if (line === tableHeader || line === tableSeparator) {
            skipSeparatorOnce = true
            continue
          }
        }
      }
    }

    // a single pathological line longer than the limit gets hard-cut
    let rest = line
    while (rest.length > limit) {
      chunks.push(rest.slice(0, limit))
      rest = rest.slice(limit)
    }
    place(rest)

    // state changes only after the line is placed, so a split at a closing
    // fence still closes the chunk it belongs to
    const fenceMatch = /^```([\w+-]*)\s*$/.exec(line)
    if (fenceMatch !== null) {
      inFence = !inFence
      fenceLanguage = inFence ? (fenceMatch[1] ?? '') : ''
    }

    if (inTable) {
      const next = lines[index + 1] ?? ''
      if (next.trim().length === 0 || !next.includes('|') || isFenceStart(next)) inTable = false
    }
  }

  if (current.trim().length > 0) {
    chunks.push(inFence ? `${current}\n\`\`\`` : current)
  }
  return chunks.filter((chunk) => chunk.length > 0)
}
