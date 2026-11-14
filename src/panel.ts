/**
 * The control center: one HTML widget that replaces the private chat's menu.
 *
 * Telegram widgets (Bot API 10.4, November 2026) are a fixed HTML document
 * drawn inside the message bubble, sandboxed with no network. The document
 * cannot change after it is sent, so the panel is a small client: tabs switch
 * between views, and every view either renders data already in the message or
 * asks the bot for a fresh copy. Answers are capped at 1024 bytes and requests
 * at one every five seconds in the background, which is why the payloads here
 * are compact and row lists drop rather than fail.
 *
 * What stays in the chat, deliberately: every irreversible operation (update,
 * plugin install/remove, restart) still confirms through the existing cards and
 * trials. The widget starts them and says where the confirmation went; it never
 * bypasses a rollback window.
 *
 * Design follows the Apple HIG translated to the widget profile: three stable
 * top-level destinations, 44 px targets, theme tokens instead of fixed colors,
 * state carried by words as well as color, a confirmation sheet for
 * destructive actions, no animation, and the numbers repeated in the caption
 * because widgets have no accessibility semantics yet.
 */

import { escapeHtml } from './render.js'

/** Workspaces listed by the panel; the rest are counted. */
export const PANEL_MAX_WORKSPACES = 6

/** `answerWidgetQuery.data` cap. */
export const PANEL_ANSWER_BYTES = 1024

/** The widget's own limits, enforced by tests. */
export const PANEL_HTML_BYTES = 32768
export const PANEL_COMPRESSED_BYTES = 4096

export interface PanelWorkspace {
  /** Short workspace id, the key the list is refreshed by. */
  id: string
  title: string
  sessions: number
  live: number
  /** A t.me link to the workspace group, when it has one. */
  url?: string
}

export interface PanelState {
  version: string
  runtime?: string
  uptimeSeconds: number
  polling: boolean
  workspaces: PanelWorkspace[]
  totalWorkspaces: number
  sessions: number
  live: number
  lastError?: string
  updatePending: boolean
  /** Unix seconds when the snapshot was taken. */
  at: number
}

export interface PanelComponent {
  name: string
  label: string
  enabled: boolean
  port?: number
}

export interface PanelPlugin {
  name: string
  version?: string
  enabled: boolean
}

/** The open supervisor trial, if one is running. */
export interface PanelTrial {
  id: string
  deadline: number | null
}

/**
 * The public t.me link for a workspace group.
 *
 * Forum topics need a supergroup, and Telegram addresses those as
 * `t.me/c/<id without the -100 prefix>`. A basic group or a private chat has no
 * such link; the row then has no target instead of a dead button.
 */
export function workspaceLink(chatId: number): string | undefined {
  if (!Number.isInteger(chatId) || chatId >= 0) return undefined
  const id = String(chatId)
  if (!id.startsWith('-100') || id.length <= 4) return undefined
  return `https://t.me/c/${id.slice(4)}`
}

/** One line of plain text: notifications, search and old clients see this. */
export function panelCaption(state: PanelState): string {
  const parts = [
    `${String(state.totalWorkspaces)} workspace${state.totalWorkspaces === 1 ? '' : 's'}`,
    `${String(state.sessions)} session${state.sessions === 1 ? '' : 's'}`,
    `${String(state.live)} live`,
    `updated ${clock(state.at)}`,
  ]
  return `control · ${parts.join(' · ')}`
}

function clock(unix: number): string {
  const date = new Date(unix * 1000)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** Titles are user input: strip control characters, keep one line, clip. */
function clip(value: string, max = 28): string {
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

// ---------------------------------------------------------------------------
// Data payloads
// ---------------------------------------------------------------------------

/** Status for the Status tab and the header. */
export function panelStatus(state: PanelState): string {
  return JSON.stringify({
    k: 's',
    up: Math.max(0, Math.round(state.uptimeSeconds)),
    po: state.polling ? 1 : 0,
    ws: state.totalWorkspaces,
    se: state.sessions,
    li: state.live,
    p: state.updatePending ? 1 : 0,
    at: Math.max(0, Math.round(state.at)),
    ...(state.lastError === undefined || state.lastError.trim().length === 0
      ? {}
      : { e: clip(state.lastError, 80) }),
  })
}

/** The workspace list; rows drop from the end until the answer fits. */
export function panelSpaces(state: PanelState): string {
  const rows = state.workspaces.map((workspace) => ({
    i: workspace.id,
    t: clip(workspace.title),
    s: workspace.sessions,
    l: workspace.live,
    ...(workspace.url === undefined ? {} : { u: workspace.url }),
  }))
  const at = Math.max(0, Math.round(state.at))
  const full = JSON.stringify({
    k: 'w',
    at,
    ws: state.totalWorkspaces,
    w: rows,
  })
  if (bytes(full) <= PANEL_ANSWER_BYTES) return full
  for (let count = rows.length - 1; count >= 0; count--) {
    const candidate = JSON.stringify({ k: 'w', at, ws: state.totalWorkspaces, w: rows.slice(0, count) })
    if (bytes(candidate) <= PANEL_ANSWER_BYTES) return candidate
  }
  return JSON.stringify({ k: 'w', at, ws: state.totalWorkspaces, w: [] })
}

export function panelComponents(components: readonly PanelComponent[]): string {
  const rows = components.slice(0, 6).map((component) => ({
    n: component.name,
    l: clip(component.label, 20),
    e: component.enabled ? 1 : 0,
    ...(component.port === undefined ? {} : { p: component.port }),
  }))
  return JSON.stringify({ k: 'c', c: rows })
}

export function panelPlugins(plugins: readonly PanelPlugin[], trial?: PanelTrial): string {
  const rows = plugins.slice(0, 6).map((plugin) => ({
    n: clip(plugin.name.replace(/^@[^/]+\//, ''), 22),
    ...(plugin.version === undefined ? {} : { v: clip(plugin.version, 16) }),
    e: plugin.enabled ? 1 : 0,
  }))
  return JSON.stringify({
    k: 'l',
    l: rows,
    ...(trial === undefined
      ? {}
      : { tr: { i: trial.id, ...(trial.deadline === null ? {} : { dl: trial.deadline }) } }),
  })
}

/** A web link for the widget to open on a later tap; never stored in the HTML. */
export function panelWeb(url: string): string {
  return JSON.stringify({ k: 'u', u: url })
}

export function panelOk(message: string): string {
  return JSON.stringify({ k: 'ok', m: message.slice(0, 120) })
}

export function panelError(message: string): string {
  return JSON.stringify({ k: 'err', m: message.slice(0, 160) })
}

// ---------------------------------------------------------------------------
// The widget document
// ---------------------------------------------------------------------------

const STYLE = `:root{color-scheme:light dark}body{margin:0;padding:10px 12px 0;font:16px/1.35 system-ui,-apple-system,sans-serif;color:var(--tg-theme-text-color)}.hd{display:flex;justify-content:space-between;align-items:baseline;gap:8px}.ttl{font-size:17px;font-weight:600}.ver{font-size:12px;color:var(--tg-theme-hint-color);text-align:right}.st{display:flex;align-items:center;gap:6px;margin-top:2px;font-size:13px;color:var(--tg-theme-hint-color)}.dot{width:8px;height:8px;border-radius:50%;background:var(--tg-theme-accent-text-color);flex:none}.dot.off{background:var(--tg-theme-destructive-text-color)}.tabs{display:flex;gap:3px;margin:10px 0 8px;padding:3px;border-radius:11px;background:var(--tg-theme-secondary-bg-color)}.tab{flex:1;min-height:38px;border:0;border-radius:9px;background:none;color:var(--tg-theme-text-color);font:inherit;font-size:14px}.tab.on{background:var(--tg-theme-button-color);color:var(--tg-theme-button-text-color);font-weight:600}.view{min-height:232px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}.tile{background:var(--tg-theme-secondary-bg-color);border-radius:12px;padding:8px 10px;min-height:58px;box-sizing:border-box}.tile b{display:block;font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}.tile span{font-size:12px;color:var(--tg-theme-hint-color)}.tile.warn b{color:var(--tg-theme-destructive-text-color)}.list{display:flex;flex-direction:column;gap:6px;margin-top:8px}.row{display:flex;align-items:center;gap:8px;min-height:44px;padding:6px 10px;border-radius:10px;background:var(--tg-theme-secondary-bg-color);color:inherit;font:inherit;text-decoration:none;border:0;box-sizing:border-box;width:100%;text-align:left}.row.plain{background:none;padding-left:2px}.grow{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.meta{font-size:12px;color:var(--tg-theme-hint-color);font-variant-numeric:tabular-nums;white-space:nowrap}.chev{color:var(--tg-theme-hint-color);font-size:18px;line-height:1}.btn{flex:none;min-height:38px;padding:0 12px;border:0;border-radius:9px;background:var(--tg-theme-bg-color);color:var(--tg-theme-text-color);font:inherit;font-size:13px}.btn.pri{background:var(--tg-theme-button-color);color:var(--tg-theme-button-text-color)}.empty{font-size:13px;color:var(--tg-theme-hint-color);padding:10px 2px}.foot{display:flex;align-items:center;gap:8px;justify-content:space-between;margin:10px 0 8px;min-height:40px;font-size:12px;color:var(--tg-theme-hint-color)}`

/** The boot snapshot: enough to draw the first screens with no request. */
function boot(state: PanelState): string {
  const data = {
    v: state.version,
    ...(state.runtime === undefined ? {} : { d: state.runtime }),
    up: Math.max(0, Math.round(state.uptimeSeconds)),
    po: state.polling ? 1 : 0,
    ws: state.totalWorkspaces,
    se: state.sessions,
    li: state.live,
    p: state.updatePending ? 1 : 0,
    at: Math.max(0, Math.round(state.at)),
    ...(state.lastError === undefined || state.lastError.trim().length === 0
      ? {}
      : { e: clip(state.lastError, 80) }),
  }
  return JSON.stringify(data).replace(/</g, '\\u003c')
}

/**
 * The widget document. Views are drawn by the script; the markup holds only the
 * frame and the three destinations, so the document stays far below the 4 KB
 * compressed limit.
 */
export function renderPanelHtml(state: PanelState): string {
  const version = escapeHtml(state.version)
  return `<style>${STYLE}</style>
<div class="hd"><span class="ttl">DeepSeek Harness</span><span class="ver">${version}</span></div>
<div class="st"><span class="dot" id="dot"></span><span id="poll">polling running</span><span>·</span><span id="up"></span></div>
<div class="tabs" id="tabs"><button class="tab on" data-tab="status">Status</button><button class="tab" data-tab="spaces">Spaces</button><button class="tab" data-tab="system">System</button></div>
<div class="view" id="view"><div class="empty">loading…</div></div>
<div class="foot" id="foot"></div>
<script>
(function () {
  var S = ${boot(state)};
  var T = window.TelegramWidget;
  var D = document;
  function $(id) { return D.getElementById(id); }
  var view = $('view');
  var foot = $('foot');
  var tabs = $('tabs');
  var current = 'status';
  var busy = false;
  var pending = null;
  var webUrl = null;
  var trial = null;

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function up(sec) {
    var m = Math.floor(sec / 60), h = Math.floor(m / 60);
    return h > 0 ? h + 'h ' + (m % 60) + 'm' : m + 'm';
  }
  function footText(text, action, label) {
    clear(foot);
    foot.appendChild(el('span', 'grow', text || ''));
    if (action) {
      var button = el('button', 'btn pri', label);
      button.onclick = action;
      foot.appendChild(button);
    }
  }
  function ask(data, done, retries) {
    if (!T) return;
    if (busy) { footText('working…'); return; }
    busy = true;
    var left = retries === undefined ? 2 : retries;
    T.request(data).then(function (answer) {
      var parsed;
      try { parsed = JSON.parse(answer.result); }
      catch (e) { parsed = { k: 'err', m: 'unreadable answer' }; }
      busy = false;
      done(parsed);
    }, function (error) {
      busy = false;
      var code = error && error.code;
      // A plugin reload restarts the bot for a moment; the request that was in
      // flight times out even though the operation landed. Ask again once the
      // bot is back, then report the last failure.
      if (left > 0 && (code === 'TIMEOUT' || code === 'FAILED')) {
        footText('retrying…');
        setTimeout(function () { ask(data, done, left - 1); }, 5000);
        return;
      }
      done({ k: 'err', m: code === 'RATE_LIMITED' ? 'wait a moment, then tap again' : 'request failed' + (code ? ' (' + code + ')' : '') });
    });
  }
  function tile(label, value, warn) {
    var node = el('div', 'tile' + (warn ? ' warn' : ''));
    node.appendChild(el('b', '', String(value)));
    node.appendChild(el('span', '', label));
    return node;
  }
  function line(label, value) {
    var row = el('div', 'row plain');
    row.appendChild(el('span', 'grow', label));
    row.appendChild(el('span', 'meta', value));
    return row;
  }
  function action(label, run) {
    var row = el('button', 'row');
    row.appendChild(el('span', 'grow', label));
    row.appendChild(el('span', 'chev', '›'));
    row.onclick = run;
    return row;
  }
  function linkRow(space) {
    var row = el(space.u ? 'a' : 'div', 'row');
    if (space.u) row.href = space.u;
    row.appendChild(el('span', 'grow', space.t));
    row.appendChild(el('span', 'meta', space.s + ' · ' + (space.l ? space.l + ' live' : 'idle')));
    if (space.u) row.appendChild(el('span', 'chev', '›'));
    return row;
  }
  function tabsOn(name) {
    for (var i = 0; i < tabs.children.length; i++) {
      var tab = tabs.children[i];
      tab.className = 'tab' + (name != null && tab.getAttribute('data-tab') === name ? ' on' : '');
    }
  }
  function status(quiet) {
    clear(view);
    var grid = el('div', 'grid');
    grid.appendChild(tile('workspaces', S.ws));
    grid.appendChild(tile('sessions', S.se));
    grid.appendChild(tile('live', S.li));
    grid.appendChild(tile('update', S.p ? 'pending' : 'clear', S.p));
    view.appendChild(grid);
    var list = el('div', 'list');
    list.appendChild(line('uptime', up(S.up)));
    list.appendChild(line('last error', S.e || 'none'));
    view.appendChild(list);
    tabsOn('status');
    $('poll').textContent = S.po ? 'polling running' : 'polling stopped';
    $('dot').className = 'dot' + (S.po ? '' : ' off');
    $('up').textContent = 'up ' + up(S.up);
    if (!quiet) {
      footText('snapshot', function () {
        ask('s', function (data) {
          if (data.k === 's') { Object.assign(S, data); status(); footText('updated'); }
          else footText(data.m || 'refresh failed');
        });
      }, 'Refresh');
    }
  }
  function spaces() {
    clear(view);
    var list = el('div', 'list');
    view.appendChild(list);
    tabsOn('spaces');
    footText('refreshing…');
    ask('w', function (data) {
      if (data.k !== 'w') { list.appendChild(el('div', 'empty', data.m || 'refresh failed')); footText(''); return; }
      S.w = data.w;
      S.ws = data.ws;
      renderSpaces(list, data.w);
      footText(data.ws + ' workspace' + (data.ws === 1 ? '' : 's'));
    });
  }
  function renderSpaces(list, items) {
    clear(list);
    if (!items.length) list.appendChild(el('div', 'empty', 'no workspaces yet'));
    for (var i = 0; i < items.length; i++) list.appendChild(linkRow(items[i]));
  }
  function system() {
    clear(view);
    var list = el('div', 'list');
    if (webUrl) {
      var web = el('div', 'row');
      web.appendChild(el('span', 'grow', 'Web UI'));
      var open = el('button', 'btn', 'Open');
      open.onclick = function () { try { T.openLink(webUrl); } catch (e) { footText('could not open the link'); } };
      web.appendChild(open);
      list.appendChild(web);
    } else {
      list.appendChild(action('Web UI', function () {
        ask('a:web', function (data) {
          if (data.k === 'u') { webUrl = data.u; system(); footText('open or copy the link'); }
          else footText(data.m || 'no signed link');
        });
      }));
    }
    list.appendChild(action('Components', function () { show('components'); }));
    list.appendChild(action('Plugins', function () { show('plugins'); }));
    if (pending === 'restart') {
      var confirm = el('div', 'row');
      confirm.appendChild(el('span', 'grow', 'Restart? turns stop'));
      var no = el('button', 'btn', 'Cancel');
      no.onclick = function () { pending = null; system(); };
      var yes = el('button', 'btn', 'Restart');
      yes.onclick = function () {
        pending = null;
        system();
        ask('a:rst', function (data) { footText(data.m || 'restarting'); });
      };
      confirm.appendChild(no);
      confirm.appendChild(yes);
      list.appendChild(confirm);
    } else {
      list.appendChild(action('Restart runtime', function () {
        pending = 'restart';
        system();
      }));
    }
    list.appendChild(action('Update setup', function () {
      ask('a:upd', function (data) { footText(data.m || 'confirmation sent below'); });
    }));
    list.appendChild(action('Help', function () {
      ask('a:help', function (data) { footText(data.m || 'sent below'); });
    }));
    view.appendChild(list);
    tabsOn('system');
    footText('changes confirm before they run');
  }
  function components() {
    clear(view);
    var list = el('div', 'list');
    view.appendChild(list);
    tabsOn('system');
    ask('c', function (data) {
      if (data.k !== 'c') { clear(list); list.appendChild(el('div', 'empty', data.m || 'the updater did not answer')); footText(''); return; }
      renderComponents(list, data.c);
      footText('changes apply through the updater');
    });
  }
  function renderComponents(list, items) {
    clear(list);
    if (!items.length) list.appendChild(el('div', 'empty', 'nothing registered'));
    for (var i = 0; i < items.length; i++) {
      (function (item) {
        var row = el('div', 'row');
        var left = el('div', 'grow');
        left.appendChild(el('div', '', item.l || item.n));
        left.appendChild(el('div', 'meta', (item.e ? 'on' : 'off') + (item.p ? ' · port ' + item.p : '')));
        row.appendChild(left);
        var toggle = el('button', 'btn', item.e ? 'Turn off' : 'Turn on');
        toggle.onclick = function () {
          ask('a:c:' + item.n + ':' + (item.e ? 'off' : 'on'), function (data) {
            if (data.k === 'c') { renderComponents(list, data.c); footText((item.e ? 'disabled ' : 'enabled ') + (item.l || item.n)); }
            else footText(data.m || 'the updater refused');
          });
        };
        row.appendChild(toggle);
        list.appendChild(row);
      })(items[i]);
    }
  }
  function plugins() {
    clear(view);
    var list = el('div', 'list');
    view.appendChild(list);
    tabsOn('system');
    ask('l', function (data) {
      if (data.k !== 'l') { clear(list); list.appendChild(el('div', 'empty', data.m || 'no plugin manager')); footText(''); return; }
      trial = data.tr || null;
      renderPlugins(list, data.l);
      footText(data.r ? 'restart to apply the change' : 'install or remove in chat');
    });
  }
  function renderPlugins(list, items) {
    clear(list);
    if (trial) {
      var banner = el('div', 'row');
      banner.appendChild(el('span', 'grow', 'trial open'));
      var commit = el('button', 'btn', 'Commit');
      commit.onclick = function () { trialAction('a:tr:c', false); };
      var rollback = el('button', 'btn', 'Roll back');
      rollback.onclick = function () { trialAction('a:tr:r', true); };
      banner.appendChild(commit);
      banner.appendChild(rollback);
      list.appendChild(banner);
    }
    for (var i = 0; i < items.length; i++) {
      (function (item) {
        var row = el('div', 'row');
        var left = el('div', 'grow');
        left.appendChild(el('div', '', item.n));
        left.appendChild(el('div', 'meta', item.e ? 'on' : 'off'));
        row.appendChild(left);
        var toggle = el('button', 'btn', item.e ? 'Turn off' : 'Turn on');
        toggle.onclick = function () {
          footText(item.e ? 'turning off…' : 'turning on…');
          ask('a:l:' + item.n + ':' + (item.e ? 'off' : 'on'), function (data) {
            if (data.k === 'l') { trial = data.tr || null; renderPlugins(list, data.l); footText((item.e ? 'disabled ' : 'enabled ') + item.n); }
            else footText(data.m || 'the plugin manager refused');
          });
        };
        row.appendChild(toggle);
        list.appendChild(row);
      })(items[i]);
    }
  }
  function trialAction(action, restarts) {
    footText(restarts ? 'rolling back…' : 'committing…');
    ask(action, function (data) {
      footText(data.m || (restarts ? 'rolling back — the bot reconnects' : 'committed'));
      if (data.k === 'ok' && !restarts) { trial = null; plugins(); }
    });
  }
  function show(name) {
    current = name;
    if (name === 'status') status();
    else if (name === 'spaces') spaces();
    else if (name === 'system') system();
    else if (name === 'components') components();
    else if (name === 'plugins') plugins();
  }
  tabs.onclick = function (event) {
    var node = event.target;
    while (node && node !== tabs && !node.getAttribute('data-tab')) node = node.parentNode;
    if (node && node !== tabs) show(node.getAttribute('data-tab'));
  };
  if (T) { try { T.ready(); } catch (e) {} }
  status();
})();
</script>`
}
