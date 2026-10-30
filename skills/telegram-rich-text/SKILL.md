---
name: telegram-rich-text
description: Format replies as Telegram rich Markdown — headings, tables, lists, details, math, footnotes, tg-time, spoilers and safe fallbacks.
whenToUse: Use when the user is reading through the Telegram connector, or when a reply benefits from structured rich Markdown (tables, headings, details, math, timestamps).
---

# Telegram rich text

The Telegram connector sends agent replies as **rich messages** (`rich_message.markdown`, Bot API 10.1+). Telegram parses the Markdown itself, so use normal GFM-style Markdown — not MarkdownV2 escaping.

## Quick reference

| Want | Write |
|---|---|
| Heading | `## Section`, `### Detail` |
| Bold / italic | `**bold**`, `*italic*` (also `__bold__`, `_italic_`) |
| Strike / mark / spoiler | `~~gone~~`, `==marked==`, `\|\|spoiler\|\|` |
| Underline / sub / sup | `<u>under</u>`, `H<sub>2</sub>O`, `x<sup>2</sup>` |
| Inline code | `` `code` `` |
| Code block | ```` ```ts ... ``` ```` |
| Bullet / numbered list | `- item`, `1. item` (nest with indentation) |
| Task list | `- [ ] todo`, `- [x] done` |
| Table | a GFM table with a header separator |
| Quote | `> text` |
| Expandable quote | `<blockquote expandable>…</blockquote>` |
| Collapsible details | `<details><summary>Title</summary>…</details>` |
| Math | `$x^2$`, `$$E=mc^2$$`, or a ```` ```math ```` fence |
| Timestamp | `<tg-time unix="1793092339" format="wDT">in a few days</tg-time>` |
| Footnote | `text[^1]` and `[^1]: definition` |
| Link | `[label](https://example.com)` |
| Button | `<tg-button type="url" url="https://example.com">Label</tg-button>` |

## Rules

- Keep tables narrow: **2–4 columns** reads best on a phone; 20 is the hard limit.
- Table cells accept **inline formatting only** — no lists or block content inside a cell.
- Never wrap the whole answer in a code fence.
- Do not use MarkdownV2 escaping; write normal Markdown.
- Do not use HTML tables; use Markdown tables so Telegram renders them natively.
- Use `<tg-time>` for deadlines and timestamps so each reader sees their own timezone.
- Prefer structure over long prose: short headings, bullets, and a table for comparisons.
- Rich messages allow 32,768 characters; the connector still splits long answers at ~3,800 and repeats table headers.
- If Telegram rejects a rich message, the connector falls back to HTML (tables as `<pre>` or key/value lists) and finally to plain text. Plain Markdown is always safe.

## Example

````markdown
## Deploy status

| Service | State | Note |
|:--------|:-----:|-----:|
| api | **ok** | 42 ms |
| web | **ok** | 18 ms |

- [x] build
- [ ] smoke test

> Rollback is automatic on a failed health gate.

Next check: <tg-time unix="1793092339" format="r">in 5 minutes</tg-time>.
````
