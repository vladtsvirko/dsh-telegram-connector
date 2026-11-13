/**
 * The live control panel: an HTML widget for the private chat with the bot.
 *
 * Telegram widgets (Bot API 10.4, November 2026) are one self-contained HTML
 * document drawn inside the message bubble and run in a QuickJS sandbox with no
 * network. The document never changes after it is sent; the widget can only ask
 * the bot with `TelegramWidget.request`, delivered as a `widget_query` update.
 * In production widgets currently exist only in the private chat with the bot,
 * which is exactly where this connector keeps its control plane.
 *
 * The panel draws a snapshot synchronously and then asks for a fresh one: first
 * shortly after it appears on screen, then every 20 seconds while visible. The
 * bot answers with a compact JSON payload (at most 1024 bytes), so a refresh
 * costs no message edit at all.
 *
 * Design follows the Apple HIG translated to the widget profile: one purpose
 * per screen, native theme tokens instead of fixed colors, 44 px rows, no
 * animation, no meaning carried by color alone, and the same numbers repeated
 * in the caption because widgets have no accessibility semantics yet.
 */

import { escapeHtml } from './render.js'

/** How many workspaces the widget lists; the rest are counted, not named. */
export const PANEL_MAX_WORKSPACES = 8

/** `answerWidgetQuery.data` is capped at 1024 bytes by the Bot API. */
export const PANEL_ANSWER_BYTES = 1024

/** The widget's own hard limits, kept here so tests can enforce them. */
export const PANEL_HTML_BYTES = 32768
export const PANEL_COMPRESSED_BYTES = 4096

export interface PanelWorkspace {
  /** Short workspace id: the stable key a refresh answer uses. */
  id: string
  title: string
  sessions: number
  live: number
  /** A t.me link to the workspace group, when it has a public supergroup. */
  url?: string
}

export interface PanelState {
  version: string
  /** The DSH runtime version, when the deployment knows it. */
  runtime?: string
  uptimeSeconds: number
  polling: boolean
  /** The workspaces the panel lists (at most PANEL_MAX_WORKSPACES). */
  workspaces: PanelWorkspace[]
  /** Every workspace the connector knows, listed or not. */
  totalWorkspaces: number
  sessions: number
  live: number
  lastError?: string
  updatePending: boolean
  /** Unix seconds when the snapshot was taken. */
  at: number
}

/**
 * The public t.me link for a workspace group, when there is one.
 *
 * Forum topics need a supergroup, and Telegram addresses those as
 * `t.me/c/<id without the -100 prefix>`. A basic group or a private chat has no
 * such link; the panel then shows the row without a target instead of a dead
 * button.
 */
export function workspaceLink(chatId: number): string | undefined {
  if (!Number.isInteger(chatId) || chatId >= 0) return undefined
  const id = String(chatId)
  if (!id.startsWith('-100') || id.length <= 4) return undefined
  return `https://t.me/c/${id.slice(4)}`
}

/** One line of plain text: what notifications, search and old clients show. */
export function panelCaption(state: PanelState): string {
  const parts = [
    `${String(state.totalWorkspaces)} workspace${state.totalWorkspaces === 1 ? '' : 's'}`,
    `${String(state.sessions)} session${state.sessions === 1 ? '' : 's'}`,
    `${String(state.live)} live`,
    `updated ${clock(state.at)}`,
  ]
  return `control · ${parts.join(' · ')}`
}

/** `19:42`; the widget has no timezone-aware formatter of its own. */
function clock(unix: number): string {
  const date = new Date(unix * 1000)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/** Titles are user input: strip control characters, keep one line, clip. */
function clip(value: string, max = 28): string {
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

function meta(workspace: PanelWorkspace): string {
  const sessions = `${String(workspace.sessions)} session${workspace.sessions === 1 ? '' : 's'}`
  return workspace.live > 0 ? `${sessions} · ${String(workspace.live)} live` : sessions
}

function row(workspace: PanelWorkspace): string {
  const name = escapeHtml(clip(workspace.title))
  const detail = escapeHtml(meta(workspace))
  if (workspace.url !== undefined) {
    return `<a class="row" href="${escapeHtml(workspace.url)}"><span class="name">${name}</span><span class="meta">${detail}</span></a>`
  }
  return `<div class="row plain"><span class="name">${name}</span><span class="meta">${detail}</span></div>`
}

const STYLE = `:root{color-scheme:light dark}
body{margin:0;padding:10px 12px 0;font:16px/1.35 system-ui,-apple-system,sans-serif;color:var(--tg-theme-text-color)}
.top{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.title{font-size:17px;font-weight:600}
.ver{font-size:12px;color:var(--tg-theme-hint-color);font-variant-numeric:tabular-nums}
.sub{display:flex;align-items:center;gap:6px;margin-top:2px;font-size:13px;color:var(--tg-theme-hint-color)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--tg-theme-accent-text-color);flex:none}
.dot.off{background:var(--tg-theme-destructive-text-color)}
.cnt{margin:8px 0 6px;font-size:13px;color:var(--tg-theme-subtitle-text-color)}
.warn{margin:6px 0;font-size:13px;color:var(--tg-theme-destructive-text-color)}
.list{display:flex;flex-direction:column;gap:6px}
.row{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:44px;padding:8px 12px;border-radius:10px;background:var(--tg-theme-secondary-bg-color);color:inherit;font:inherit;text-decoration:none;box-sizing:border-box}
.row.plain{background:none;padding-left:2px}
.name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.meta{flex:none;font-size:13px;color:var(--tg-theme-hint-color);font-variant-numeric:tabular-nums}
.empty{font-size:13px;color:var(--tg-theme-hint-color);padding:8px 2px}
.foot{display:flex;gap:8px;justify-content:space-between;margin:10px 2px 8px;font-size:12px;color:var(--tg-theme-hint-color)}
.foot span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
button{font:inherit;min-height:44px;width:100%;border:0;border-radius:10px;background:var(--tg-theme-button-color);color:var(--tg-theme-button-text-color)}
button:active{opacity:.7}
button[disabled]{opacity:.5}`

/** `3h 12m`, for the snapshot rendered before any script runs. */
function uptime(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60)
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${String(hours)}h ${String(minutes % 60)}m` : `${String(minutes)}m`
}

/**
 * The widget document. It must be valid without JavaScript: a client that runs
 * no scripts still shows the snapshot, the caption and the refresh button.
 */
export function renderPanelHtml(state: PanelState): string {
  const listed = state.workspaces
  const hidden = Math.max(0, state.totalWorkspaces - listed.length)
  const rows = listed.length === 0
    ? '<div class="empty">no workspaces yet — send /workspace new</div>'
    : listed.map(row).join('')
  const more = hidden > 0
    ? `<div class="empty">+${String(hidden)} more — /workspaces lists every workspace</div>`
    : ''
  const update = state.updatePending
    ? '<div class="warn" id="upd">system update pending — commands are paused</div>'
    : '<div class="warn" id="upd" hidden></div>'
  // Only the ids and links are needed for a re-render: the bot's refresh answer
  // carries the numbers, and a fresh workspace without a link stays readable.
  const boot = JSON.stringify({
    w: listed.filter((workspace) => workspace.url !== undefined).map((workspace) => ({
      i: workspace.id,
      u: workspace.url,
    })),
  }).replace(/</g, '\\u003c')
  const version = escapeHtml(state.version)
  const runtime = state.runtime === undefined ? '' : ` · DSH ${escapeHtml(state.runtime)}`
  const live = `${String(state.totalWorkspaces)} workspace${state.totalWorkspaces === 1 ? '' : 's'} · ${String(state.sessions)} session${state.sessions === 1 ? '' : 's'} · ${String(state.live)} live`

  return `<style>${STYLE}</style>
<div class="top"><span class="title">DeepSeek Harness</span><span class="ver">${version}${runtime}</span></div>
<div class="sub"><span class="dot${state.polling ? '' : ' off'}" id="dot"></span><span id="poll">${state.polling ? 'polling running' : 'polling stopped'}</span><span>·</span><span id="up">up ${uptime(state.uptimeSeconds)}</span></div>
<div class="cnt" id="cnt">${escapeHtml(live)}</div>
${update}
<div class="list" id="rows">${rows}${more}</div>
<div class="foot"><span id="at">updated ${clock(state.at)}</span><span id="err">last error: none</span></div>
<button id="rf" type="button">Refresh</button>
<script>
(function () {
  var S = ${boot};
  var T = window.TelegramWidget;
  var root = document.getElementById('rows');
  var urls = {};
  S.w.forEach(function (w) { urls[w.i] = w.u; });
  function up(sec) {
    var m = Math.floor(sec / 60), h = Math.floor(m / 60);
    return h > 0 ? h + 'h ' + (m % 60) + 'm' : m + 'm';
  }
  function at(unix) {
    try { return new Date(unix * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return ''; }
  }
  function row(w) {
    var el = document.createElement(urls[w.i] ? 'a' : 'div');
    el.className = 'row' + (urls[w.i] ? '' : ' plain');
    if (urls[w.i]) el.href = urls[w.i];
    var n = document.createElement('span');
    n.className = 'name';
    n.textContent = w.t;
    var m = document.createElement('span');
    m.className = 'meta';
    m.textContent = w.s + (w.l ? ' · ' + w.l + ' live' : ' · idle');
    el.appendChild(n);
    el.appendChild(m);
    return el;
  }
  function show(id, text) { document.getElementById(id).textContent = text; }
  function render(s) {
    if (s.t === 'e') { show('err', s.m); return; }
    show('poll', s.po ? 'polling running' : 'polling stopped');
    document.getElementById('dot').className = 'dot' + (s.po ? '' : ' off');
    show('up', 'up ' + up(s.up));
    show('cnt', s.ws + ' workspace' + (s.ws === 1 ? '' : 's') + ' · ' + s.se + ' session' + (s.se === 1 ? '' : 's') + ' · ' + s.li + ' live');
    show('at', 'updated ' + at(s.at));
    show('err', s.e ? 'last error: ' + s.e : 'last error: none');
    document.getElementById('upd').hidden = !s.p;
    while (root.firstChild) root.removeChild(root.firstChild);
    if (!s.w.length) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'no workspaces yet — send /workspace new';
      root.appendChild(empty);
      return;
    }
    for (var i = 0; i < s.w.length; i++) root.appendChild(row(s.w[i]));
  }
  var busy = false;
  function refresh() {
    if (!T || busy) return;
    busy = true;
    var b = document.getElementById('rf');
    b.disabled = true;
    b.textContent = 'Refreshing…';
    T.request('status').then(function (a) {
      var s;
      try { s = JSON.parse(a.result); }
      catch (e) { show('err', 'the answer was not readable'); return; }
      render(s);
    }, function (e) {
      show('err', e && e.code === 'RATE_LIMITED'
        ? 'refreshed too recently — tap again in a moment'
        : 'refresh failed' + (e && e.code ? ' (' + e.code + ')' : ''));
    }).then(function () {
      busy = false;
      b.disabled = false;
      b.textContent = 'Refresh';
    });
  }
  show('up', 'up ' + up(${String(Math.max(0, Math.round(state.uptimeSeconds)))}));
  show('poll', ${state.polling ? "'polling running'" : "'polling stopped'"});
  show('at', 'updated ' + at(${String(Math.max(0, Math.round(state.at)))}));
  document.getElementById('rf').addEventListener('click', refresh);  if (T) {
    try { T.ready(); } catch (e) {}
    setTimeout(refresh, 1500);
    setInterval(function () { if (T.isActive) refresh(); }, 20000);
  }
})();
</script>`
}

interface RefreshPayload {
  t: 's'
  up: number
  po: 0 | 1
  at: number
  ws: number
  se: number
  li: number
  p?: 0 | 1
  e?: string
  w: { i: string; t: string; s: number; l: number }[]
}

function payload(state: PanelState, rows: PanelWorkspace[], error: string | undefined): string {
  const body: RefreshPayload = {
    t: 's',
    up: Math.max(0, Math.round(state.uptimeSeconds)),
    po: state.polling ? 1 : 0,
    at: Math.max(0, Math.round(state.at)),
    ws: state.totalWorkspaces,
    se: state.sessions,
    li: state.live,
    ...(state.updatePending ? { p: 1 as const } : {}),
    ...(error === undefined ? {} : { e: error }),
    w: rows.map((workspace) => ({
      i: workspace.id,
      t: clip(workspace.title),
      s: workspace.sessions,
      l: workspace.live,
    })),
  }
  return JSON.stringify(body)
}

/**
 * The answer to a widget's `status` request: JSON, at most 1024 bytes.
 *
 * The full list is tried first; rows are dropped from the end until it fits,
 * and the totals and errors survive even when the list does not. A widget that
 * cannot refresh still shows its snapshot, so a degraded answer is better than
 * a failed one.
 */
export function panelRefresh(state: PanelState): string {
  const error = state.lastError === undefined || state.lastError.trim().length === 0
    ? undefined
    : clip(state.lastError, 80)
  const full = payload(state, state.workspaces, error)
  if (byteLength(full) <= PANEL_ANSWER_BYTES) return full
  for (let count = state.workspaces.length - 1; count >= 0; count--) {
    const candidate = payload(state, state.workspaces.slice(0, count), error)
    if (byteLength(candidate) <= PANEL_ANSWER_BYTES) return candidate
  }
  const bare = payload(state, [], undefined)
  if (byteLength(bare) <= PANEL_ANSWER_BYTES) return bare
  return JSON.stringify({ t: 's', up: 0, po: state.polling ? 1 : 0, at: 0, ws: state.totalWorkspaces, se: state.sessions, li: state.live, w: [] })
}
