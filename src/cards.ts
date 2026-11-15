/**
 * The private-chat card app: one widget document per screen.
 *
 * A widget is fixed HTML capped at 32 KB / 4 KB compressed, so the app cannot
 * be one document. Each screen is its own card; navigations delete the current
 * card and send the next one, which is how the menu/status cards in Telegram's
 * commerce bots behave. The chat therefore holds exactly one card at a time.
 *
 * Every card shares the same small runtime: buttons either navigate (`n:`) or
 * act (`a:`), the bot answers with a compact JSON object, and the card renders
 * the outcome, a confirmation button, a link or the next screen. Answers are
 * capped at 1024 bytes and retried once when the bot is restarting.
 *
 * Text cannot be typed into a widget. Flows that need a name or a package spec
 * fall back to a single chat prompt; everything else stays in the card.
 */

import { escapeHtml } from './render.js'
import type { TgInlineButton, TgInlineKeyboard } from './telegram.js'

/** Telegram's limits, enforced by tests. */
export const CARD_HTML_BYTES = 32768
export const CARD_COMPRESSED_BYTES = 4096

export type CardScreen = string

export interface CardTile {
  title: string
  meta?: string
  go?: string
  act?: string
}

export interface CardRow {
  title: string
  meta?: string
  href?: string
  go?: string
  act?: string
}

export interface CardLine {
  k: string
  v: string
}

export interface CardChip {
  label: string
  value: string
  on?: boolean
}

export interface CardAction {
  label: string
  act?: string
  href?: string
  tone?: 'pri' | 'bad'
}

export interface CardView {
  screen: CardScreen
  title: string
  version: string
  back?: string
  hero?: { big: string; meta: string }
  tiles?: CardTile[]
  lines?: CardLine[]
  rows?: CardRow[]
  chips?: { label: string; items: CardChip[]; apply: string }
  actions?: CardAction[]
  note?: string
  caption: string
}

/** JSON literal for an inline handler argument; values are server-generated. */
function arg(value: string): string {
  return JSON.stringify(value)
}

const STYLE = `:root{color-scheme:light dark}
body{margin:0;padding:10px 12px 0;font:16px/1.35 system-ui,-apple-system,sans-serif;color:var(--tg-theme-text-color)}
.top{display:flex;align-items:center;gap:8px;min-height:32px}
.back{border:0;background:none;color:var(--tg-theme-link-color);font:inherit;font-size:20px;padding:0 4px;width:28px}
.ttl{flex:1;font-size:17px;font-weight:600}
.ver{font-size:12px;color:var(--tg-theme-hint-color)}
.hero{margin:8px 0 10px;padding:12px;border-radius:12px;background:var(--tg-theme-secondary-bg-color)}
.hero b{display:block;font-size:19px;font-weight:600}
.hero span{font-size:13px;color:var(--tg-theme-hint-color)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.tile{min-height:66px;text-align:left;border:0;border-radius:12px;padding:10px;background:var(--tg-theme-secondary-bg-color);color:var(--tg-theme-text-color);font:inherit}
.tile b{display:block;font-size:15px}
.tile span{font-size:12px;color:var(--tg-theme-hint-color)}
.lines{display:flex;flex-direction:column;gap:4px;margin-top:8px}
.line{display:flex;justify-content:space-between;gap:10px;padding:6px 2px;border-bottom:1px solid var(--tg-theme-section-separator-color)}
.line .k{color:var(--tg-theme-hint-color);flex:none}
.line .v{text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.list{display:flex;flex-direction:column;gap:6px;margin-top:8px}
.row{display:flex;align-items:center;gap:8px;width:100%;min-height:44px;padding:6px 10px;border:0;border-radius:10px;background:var(--tg-theme-secondary-bg-color);color:inherit;font:inherit;text-decoration:none;box-sizing:border-box;text-align:left}
.row.plain{background:none;padding-left:2px}
.grow{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.meta{font-size:12px;color:var(--tg-theme-hint-color);white-space:nowrap}
.chev{color:var(--tg-theme-hint-color);font-size:18px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.chip{border:0;border-radius:20px;padding:0 12px;min-height:34px;background:var(--tg-theme-secondary-bg-color);color:var(--tg-theme-text-color);font:inherit;font-size:13px}
.chip.on{background:var(--tg-theme-button-color);color:var(--tg-theme-button-text-color)}
.actions{display:flex;gap:8px;margin-top:10px}
.action{flex:1;min-height:44px;border:0;border-radius:10px;background:var(--tg-theme-secondary-bg-color);color:var(--tg-theme-text-color);font:inherit;font-size:15px;text-align:center;text-decoration:none;box-sizing:border-box;padding:12px 8px}
.action.pri{background:var(--tg-theme-button-color);color:var(--tg-theme-button-text-color);font-weight:600}
.action.bad{color:var(--tg-theme-destructive-text-color);font-weight:600}
.note{font-size:12px;color:var(--tg-theme-hint-color);margin:8px 2px}
.foot{display:flex;align-items:center;gap:8px;min-height:40px;margin:10px 0 8px;font-size:12px;color:var(--tg-theme-hint-color)}
.mini{border:0;border-radius:8px;padding:8px 12px;background:var(--tg-theme-button-color);color:var(--tg-theme-button-text-color);font:inherit;font-size:13px}`

function tile(item: CardTile): string {
  const handler = item.go === undefined ? `act(${arg(item.act ?? '')})` : `go(${arg(item.go)})`
  return `<button class="tile" onclick='${handler}'><b>${escapeHtml(item.title)}</b>${item.meta === undefined ? '' : `<span>${escapeHtml(item.meta)}</span>`}</button>`
}

function row(item: CardRow): string {
  const content = `<span class="grow">${escapeHtml(item.title)}</span>${item.meta === undefined ? '' : `<span class="meta">${escapeHtml(item.meta)}</span>`}`
  if (item.href !== undefined) return `<a class="row" href="${escapeHtml(item.href)}">${content}<span class="chev">›</span></a>`
  if (item.go !== undefined) return `<button class="row" onclick='go(${arg(item.go)})'>${content}<span class="chev">›</span></button>`
  if (item.act !== undefined) return `<button class="row" onclick='act(${arg(item.act)})'>${content}<span class="chev">›</span></button>`
  return `<div class="row plain">${content}</div>`
}

function action(item: CardAction): string {
  const cls = `action${item.tone === undefined ? '' : ` ${item.tone}`}`
  if (item.href !== undefined) return `<a class="${cls}" href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`
  return `<button class="${cls}" onclick='act(${arg(item.act ?? '')})'>${escapeHtml(item.label)}</button>`
}

function chips(section: NonNullable<CardView['chips']>): string {
  const items = section.items
    .map((item) => `<button class="chip${item.on === true ? ' on' : ''}" onclick='pick(this,${arg(item.value)})'>${escapeHtml(item.label)}</button>`)
    .join('')
  return `<div class="note">${escapeHtml(section.label)}</div><div class="chips">${items}</div><button class="action pri" onclick='applyChip()'>Apply</button>`
}

const SCRIPT = `(function () {
  var T = window.TelegramWidget;
  var busy = false;
  var picked = null;
  var CHIP = ${'CHIP_APPLY'};
  function $(id) { return document.getElementById(id); }
  function setFoot(text) {
    var foot = $('f');
    while (foot.firstChild) foot.removeChild(foot.firstChild);
    var span = document.createElement('span');
    span.className = 'grow';
    span.textContent = text || '';
    foot.appendChild(span);
    return foot;
  }
  function addButton(foot, label, handler) {
    var button = document.createElement('button');
    button.className = 'mini';
    button.textContent = label;
    button.onclick = handler;
    foot.appendChild(button);
  }
  function foot(text, action, label, url) {
    var node = setFoot(text);
    if (url) {
      addButton(node, 'Open', function () { try { T.openLink(url); } catch (e) {} });
      addButton(node, 'Copy', function () { try { T.copyText(url); } catch (e) {} });
    } else if (action) {
      addButton(node, label || 'Confirm', function () { act(action); });
    }
  }
  function handle(data) {
    if (!data) return;
    if (data.k === 'ok') foot(data.m || 'done');
    else if (data.k === 'err') foot(data.m || 'failed');
    else if (data.k === 'q') foot(data.m || 'confirm?', data.a, data.l);
    else if (data.k === 'w' || data.k === 'u') foot('link ready', null, null, data.u);
    else if (data.k === 'n') go(data.t);
  }
  function ask(data, done, left) {
    if (!T) return;
    if (busy) { setFoot('working…'); return; }
    busy = true;
    var tries = left === undefined ? 2 : left;
    T.request(data).then(function (answer) {
      var parsed;
      try { parsed = JSON.parse(answer.result); }
      catch (e) { parsed = { k: 'err', m: 'unreadable answer' }; }
      busy = false;
      done(parsed);
    }, function (error) {
      busy = false;
      var code = error && error.code;
      if (tries > 0 && (code === 'TIMEOUT' || code === 'FAILED')) {
        setFoot('retrying…');
        setTimeout(function () { ask(data, done, tries - 1); }, 5000);
        return;
      }
      done({ k: 'err', m: code === 'RATE_LIMITED' ? 'wait a moment, then tap again' : 'request failed' + (code ? ' (' + code + ')' : '') });
    });
  }
  window.go = function (target) { setFoot('opening…'); ask('n:' + target, handle); };
  window.act = function (action) { setFoot('working…'); ask('a:' + action, handle); };
  window.pick = function (element, value) {
    var group = element.parentNode.children;
    for (var i = 0; i < group.length; i++) group[i].className = 'chip';
    element.className = 'chip on';
    picked = value;
  };
  window.applyChip = function () {
    if (!picked) { setFoot('pick one first'); return; }
    // Telegram caps one widget request at 64 bytes.
    if (('a:' + CHIP + ':' + picked).length > 64) { setFoot('name too long for a tap — use /model'); return; }
    window.act(CHIP + ':' + picked);
  };
  if (T) { try { T.ready(); } catch (e) {} }
})();`

/** Render one card. `chips.apply` is the action prefix the Apply button uses. */
export function renderCard(view: CardView): string {
  const chipApply = view.chips?.apply ?? ''
  const back = view.back === undefined
    ? '<span class="back"></span>'
    : `<button class="back" onclick='go(${arg(view.back)})'>‹</button>`
  const hero = view.hero === undefined
    ? ''
    : `<div class="hero"><b>${escapeHtml(view.hero.big)}</b><span>${escapeHtml(view.hero.meta)}</span></div>`
  const tiles = view.tiles === undefined ? '' : `<div class="grid">${view.tiles.map(tile).join('')}</div>`
  const lines = view.lines === undefined
    ? ''
    : `<div class="lines">${view.lines.map((line) => `<div class="line"><span class="k">${escapeHtml(line.k)}</span><span class="v">${escapeHtml(line.v)}</span></div>`).join('')}</div>`
  const rows = view.rows === undefined ? '' : `<div class="list">${view.rows.map(row).join('')}</div>`
  const chipSection = view.chips === undefined ? '' : chips(view.chips)
  const actionSection = view.actions === undefined ? '' : `<div class="actions">${view.actions.map(action).join('')}</div>`
  const note = view.note === undefined ? '' : `<div class="note">${escapeHtml(view.note)}</div>`

  return `<style>${STYLE}</style>
<div class="top">${back}<span class="ttl">${escapeHtml(view.title)}</span><span class="ver">${escapeHtml(view.version)}</span></div>
${hero}${lines}${rows}${tiles}${chipSection}${note}${actionSection}
<div class="foot" id="f"></div>
<script>${SCRIPT.split('CHIP_APPLY').join(arg(chipApply))}</script>`
}


// ---------------------------------------------------------------------------
// Rich-message fallback
// ---------------------------------------------------------------------------

/**
 * The same card, rendered as a rich message with an inline keyboard.
 *
 * Telegram disabled HTML widgets on 2026-11-13 after security reports, so the
 * card app needs a carrier that still exists. Rich messages (Bot API 10.1+)
 * support headings, lists and inline keyboards; navigation edits the same
 * message in place, which keeps the one-screen behaviour without widgets.
 */
export interface RichCard {
  html: string
  keyboard: TgInlineKeyboard
}

/** Telegram button labels are short; keep them readable. */
const BUTTON_TEXT_MAX = 60

function buttonText(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= BUTTON_TEXT_MAX ? clean : `${clean.slice(0, BUTTON_TEXT_MAX - 1)}…`
}

/** Callback data is capped at 64 bytes; a card without it is not tappable. */
function callbackData(value: string): string | undefined {
  const data = `rc:${value}`
  return data.length <= 64 ? data : undefined
}

export function renderRichCard(view: CardView): RichCard {
  const html: string[] = [`<p><b>${escapeHtml(view.title)}</b> <i>${escapeHtml(view.version)}</i></p>`]
  if (view.hero !== undefined) {
    html.push(`<p><b>${escapeHtml(view.hero.big)}</b></p>`)
    html.push(`<p><i>${escapeHtml(view.hero.meta)}</i></p>`)
  }
  for (const line of view.lines ?? []) {
    html.push(`<p><b>${escapeHtml(line.k)}</b> — ${escapeHtml(line.v)}</p>`)
  }
  if (view.rows !== undefined && view.rows.length > 0) {
    const items = view.rows
      .map((row) => `<li><b>${escapeHtml(row.title)}</b>${row.meta === undefined ? '' : ` — ${escapeHtml(row.meta)}`}</li>`)
      .join('')
    html.push(`<ul>${items}</ul>`)
  }
  if (view.chips !== undefined) html.push(`<p><b>${escapeHtml(view.chips.label)}</b></p>`)
  if (view.note !== undefined) html.push(`<p><i>${escapeHtml(view.note)}</i></p>`)

  const rows: TgInlineButton[][] = []
  const push = (text: string, value?: string, url?: string): void => {
    if (url !== undefined) {
      rows.push([{ text: buttonText(text), url }])
      return
    }
    if (value === undefined) return
    const data = callbackData(value)
    if (data !== undefined) rows.push([{ text: buttonText(text), callback_data: data }])
  }

  if (view.back !== undefined) push('‹ Back', `n:${view.back}`)
  else if (view.screen !== 'home') push('⌂ Home', 'n:home')

  const tiles = view.tiles ?? []
  for (let index = 0; index < tiles.length; index += 2) {
    const row: TgInlineButton[] = []
    for (const tile of tiles.slice(index, index + 2)) {
      const value = tile.go !== undefined ? `n:${tile.go}` : tile.act === undefined ? undefined : `a:${tile.act}`
      const data = value === undefined ? undefined : callbackData(value)
      if (data !== undefined) row.push({ text: buttonText(tile.title), callback_data: data })
    }
    if (row.length > 0) rows.push(row)
  }

  for (const row of view.rows ?? []) {
    const label = row.meta === undefined ? row.title : `${row.title} · ${row.meta}`
    if (row.href !== undefined) push(label, undefined, row.href)
    else if (row.go !== undefined) push(label, `n:${row.go}`)
    else if (row.act !== undefined) push(label, `a:${row.act}`)
  }

  if (view.chips !== undefined) {
    let row: TgInlineButton[] = []
    for (const chip of view.chips.items) {
      const data = callbackData(`a:${view.chips.apply}:${chip.value}`)
      if (data === undefined) continue
      row.push({ text: buttonText(`${chip.on === true ? '✓ ' : ''}${chip.label}`), callback_data: data })
      if (row.length === 2) {
        rows.push(row)
        row = []
      }
    }
    if (row.length > 0) rows.push(row)
  }

  for (const action of view.actions ?? []) {
    if (action.href !== undefined) push(action.label, undefined, action.href)
    else if (action.act !== undefined) push(action.label, `a:${action.act}`)
  }

  return { html: html.join('\n'), keyboard: { inline_keyboard: rows } }
}
