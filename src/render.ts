/**
 * Markdown → Telegram HTML, and message splitting.
 *
 * Telegram's HTML parse mode accepts a small tag set, so agent output is escaped
 * first and then a deliberately tiny subset of Markdown is re-introduced. Anything
 * not understood stays literal text, which is the safe failure mode.
 */

export const MAX_MESSAGE = 4096
/** Leave room for the tags a split can add (pre/code reopen). */
export const SAFE_LENGTH = 3800

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Wrap runs of "> " lines in <blockquote>, converting markdown in the surrounding
 * text too — doing this after inline() left labels like **you (web)** literal.
 */
function blockquotes(text: string): string {
  const out: string[] = []
  const re = /(?:^>\s?.*(?:\n|$))+/gm
  let cursor = 0
  for (const match of text.matchAll(re)) {
    const at = match.index ?? 0
    if (at > cursor) out.push(inline(text.slice(cursor, at)))
    const inner = match[0]
      .split('\n')
      .filter((line) => line.startsWith('>'))
      .map((line) => line.replace(/^>\s?/, ''))
      .join('\n')
    out.push(`<blockquote>${inline(inner)}</blockquote>`)
    cursor = at + match[0].length
  }
  if (cursor < text.length) out.push(inline(text.slice(cursor)))
  return out.join('')
}

function inline(text: string): string {
  let out = escapeHtml(text)
  // inline code first: its content must not be touched by later rules
  out = out.replace(/`([^`\n]+)`/g, (_m, code: string) => `<code>${code}</code>`)
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, url: string) => `<a href="${url}">${label}</a>`)
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>')
  return out
}

/**
 * Telegram renders `<tg-time>` in the reader's own timezone. It is the one tag
 * this renderer lets through; everything else is escaped. The fallback text is
 * what clients without support show.
 */
const TG_TIME = /<tg-time\s+unix="(\d{1,12})"(?:\s+format="([^"]*)")?\s*>([\s\S]*?)<\/tg-time>/g

function protectTimes(markdown: string): { text: string; tags: string[] } {
  const tags: string[] = []
  const text = markdown.replace(TG_TIME, (_match, unix: string, format: string | undefined, fallback: string) => {
    const resolved = format ?? ''
    if (resolved !== '' && !/^(r|w?[dD]?[tT]?)$/.test(resolved)) return fallback
    const attribute = resolved === '' ? '' : ` format="${resolved}"`
    tags.push(`<tg-time unix="${unix}"${attribute}>${escapeHtml(fallback)}</tg-time>`)
    return `\u0000TG${tags.length - 1}\u0000`
  })
  return { text, tags }
}

/** Convert a Markdown-ish string into the HTML subset Telegram accepts. */
export function toTelegramHtml(markdown: string): string {
  const protectedTimes = protectTimes(markdown)
  const body = convert(protectedTimes.text)
  return body.replace(/\u0000TG(\d+)\u0000/g, (_match, index: string) => protectedTimes.tags[Number(index)] ?? '')
}

function convert(markdown: string): string {
  const parts: string[] = []
  const fence = /```([\w+-]*)\n?([\s\S]*?)```/g
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = fence.exec(markdown)) !== null) {
    parts.push(inline(markdown.slice(cursor, match.index)))
    const language = match[1] ?? ''
    const code = escapeHtml((match[2] ?? '').replace(/\n$/, ''))
    parts.push(`<pre>${language.length > 0 ? `<code class="language-${escapeHtml(language)}">${code}</code>` : code}</pre>`)
    cursor = match.index + match[0].length
  }
  parts.push(blockquotes(markdown.slice(cursor)))
  return parts.join('')
}

/**
 * Split text into Telegram-sized chunks, preferring newline boundaries and
 * keeping fenced code blocks balanced so no chunk ends mid-fence.
 */
export function splitMessage(text: string, limit = SAFE_LENGTH): string[] {
  const normalized = text.replace(/\r\n/g, '\n')
  if (normalized.length <= limit) return [normalized]

  const chunks: string[] = []
  let current = ''
  let inFence = false
  let fenceLanguage = ''

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

  for (const line of normalized.split('\n')) {
    if (current.length + line.length + 1 > limit) {
      push()
      // a single pathological line longer than the limit gets hard-cut
      let rest = line
      while (rest.length > limit) {
        chunks.push(rest.slice(0, limit))
        rest = rest.slice(limit)
      }
      place(rest)
    } else {
      place(line)
    }

    // state changes only after the line is placed, so a split at a closing
    // fence still closes the chunk it belongs to
    const fenceMatch = /^```([\w+-]*)\s*$/.exec(line)
    if (fenceMatch !== null) {
      inFence = !inFence
      fenceLanguage = inFence ? (fenceMatch[1] ?? '') : ''
    }
  }

  if (current.trim().length > 0) {
    chunks.push(inFence ? `${current}\n\`\`\`` : current)
  }
  return chunks.filter((chunk) => chunk.length > 0)
}
