# dsh-telegram-connector

Drive a [DeepSeek Harness](https://github.com/deepseek-ai) runtime from Telegram —
same workspaces, same sessions, same tools as the web UI, from your phone.

One **Telegram group per workspace**, one **forum topic per session**. A session
started in the browser can be adopted as a topic with its history (`/sync`); a
session started from the phone is the same session in the browser. There is no
shadow store of conversations: Telegram is a projection of the harness.

```
private chat with the bot        control plane: workspaces, links, status
group "web-app"                  one workspace
 ├── General (or your /dashboard topic)   dashboard: /new, /sync, session admin
 ├── session-9cb8…               one session
 └── session-2f41…               one session
group "landing-page"             another workspace
 └── …
```

The full command reference is [`docs/COMMANDS.md`](docs/COMMANDS.md) — the bot's
`/man` prints the same text, and every command accepts `--help`. The reasoning
behind the mapping is in [`docs/DESIGN.md`](docs/DESIGN.md); supported DSH
versions are in [`COMPATIBILITY.md`](COMPATIBILITY.md).

## Features

- **Topics are sessions.** Create a topic by hand and start talking, or let the
  bot create one per session with `/new`. Topics are never silently re-assigned.
- **Web ↔ phone continuity.** `/sync` adopts sessions created in the web UI,
  creates a topic for each and replays the tail of the conversation. Renaming
  round-trips both ways, and closing a topic archives its session. Archiving
  from the web UI is **not** mirrored: run `/close` for that.
- **Streaming replies.** One message per turn, edited in place as the model
  writes. Telegram rich messages render Markdown headings and lists natively;
  **tables are rewritten before sending** — a monospaced code block when they
  fit, a bullet list when they do not — because not every Telegram client
  renders a GFM table. If the API rejects rich content, an HTML subset takes
  over and finally plain text. Splitting is fence- and table-aware.
- **Read and streaming reactions.** The bot reacts 👀 to a prompt when it reads
  it, and ✍ to a reply while it is still being edited; the streaming reaction is
  removed when the turn settles. Media without a caption is staged and marked
  🙉 until a caption or the next text prompt. Change any emoji online with
  `/reactions` (Telegram's fixed reaction set is validated).
- **Attachments.** Photos, image documents, videos, video notes, audio, voice
  notes and animations are downloaded through the Bot API and attached with
  DSH's attachment service. Albums are debounced and attached together; a
  captionless upload waits for the prompt instead of starting one turn per file.
- **Reply-to reuse.** Reply to an earlier photo/file/video/audio message to
  attach it to the new prompt. The referenced message is included as a quoted
  context block; external replies are supported and download errors are surfaced
  to the model so it can suggest a fix.
- **Forwarded messages.** A forwarded message becomes a `Forwarded from …`
  context turn; forwarded rich messages are read from `rich_message.blocks`, and
  a reply to a forwarded message also records its origin in the reference block.
- **Process rows.** Tool calls, host commands and skill loads become short safe
  rows. `processMode: live` is the default: one card is edited while the turn
  runs and collapses to a summary at the end. `summary` sends only the collapsed
  summary; `off` hides process rows. Web-UI sessions follow the same mode.
- **Host commands and skills.** `/commands` and `/skills` read the live
  registries; `/<name>` loads a user-invocable skill, so commands and skills from
  newly installed plugins work without a connector release. `/run` bypasses a
  connector name collision and `/skill` forces a skill.
- **Slash rules.** Only a leading slash (after leading whitespace) starts a
  command; slashes later in a message are literal. `/commands@bot` works, and
  `//text` sends a prompt that starts with `/`. Media sent with a skill is
  attached to that turn; media sent with a command is staged for the next
  prompt, because commands do not take attachments.
- **Telegram-native formatting.** Every Telegram session gets a system-prompt
  section that tells the model to use Telegram rich Markdown; the full cheat
  sheet is a runtime skill (`telegram-rich-text`). Headings, lists, details,
  math, footnotes and `<tg-time>` render natively; tables are converted to a
  code block or a bullet list on the way out (see above).
- **Commands live in one place.** A dashboard topic holds `/new`, `/sync`,
  `/close`, `/rename`, `/model` and friends; session topics accept plain text.
- **Plugins from the chat.** `/plugins` lists the profile's bundles, `/plugin add`
  inspects a spec before anything runs and asks for a confirmation, and
  `enable`/`disable`/`remove` work without opening a terminal.
- **Channel-aware prompts.** A Telegram prompt reaches the agent with a
  `[via Telegram]` marker, so the answer can use chat steps instead of host
  commands. Web UI prompts are unmarked; the marker is in the session, not in
  the Telegram message.
- **Dashboard card.** `/dashboard` posts the common actions as inline buttons:
  new session, sync, status and sessions in a group; status, web link, update,
  restart, plugins and components in the bot chat. Deployment buttons are
  admin-only, exactly like the typed commands.
- **Host-free after install.** The runtime runs under a
  supervisor: every plugin confirmation opens a rollback window (live under HMR,
  or around a restart), and `/system update connector` reinstalls the pinned
  connector the same way. `/system update setup` confirms, drains agents and moves the whole
  setup through the updater sidecar. The trial comes with Commit / Roll back
  buttons; ignore it and it rolls back by itself. A dead runtime, a dead updater,
  a broken `.env` or the host itself still needs a shell — that boundary is
  documented in the setup repo's
  [LIMITS.md](https://github.com/vladtsvirko/dsh-tg-docker-setup/blob/main/docs/LIMITS.md).
- **Durable.** Bindings survive restarts, sessions are resumed, not recreated.
- **Allowlisted.** Only Telegram user ids you list can drive the bot.

## Status

Built and tested against DSH `0.2.1-rc.5`; unit tests for rendering, reactions,
bindings and the plugin surface, `tsc --noEmit` clean.

| Part | State |
|---|---|
| Bot API client (`src/telegram.ts`) | done — topics, titles, close/reopen, deletes |
| Rendering (`src/render.ts`) | done — rich Markdown, tables as a code block or bullets, HTML/plain fallbacks, fence- and table-aware split |
| Telegram agent context (`src/telegram-prompt.ts`) | done — per-session prompt section + `telegram-rich-text` skill |
| Bindings (`src/bindings.ts`) | done — atomic JSON, v2 schema |
| Control plane, groups, topics, streaming | done |
| Sync: workspace ⇄ group, session ⇄ topic, topic close ⇄ session archive | done (an archive made in the web UI is not mirrored) |
| `/sync` adoption + history replay | done |
| Plugins surface (`src/plugins.ts`) | done — list, info, add with confirm, enable/disable, remove |
| Automation surface | not implemented — `/schedules` is a stub |

## Requirements

- A DSH runtime with the `web` profile and the `agents` service (any normal
  install). Optional pieces — workspace registry, session query/title, plugin
  manager, the container supervisor — are detected at runtime, and the features
  that need them say so instead of crashing.
- A Telegram bot from [@BotFather](https://t.me/BotFather).
- A group with **Topics enabled** and the bot as **admin** with *Manage Topics*
  (plus *Change Info* if you want group title sync).
- **Privacy mode off** for the bot (BotFather → `/setprivacy` → Disable).
  Otherwise it cannot see plain messages in topics, which is the entire input
  path.
- One running instance per bot token: a single long-poll loop.

Bots cannot create groups or enable Topics, so `workspace new` prints a
one-tap `?startgroup=` link — you create the group, the bot binds it.

## Install

The supported path is the setup repository, which installs the runtime, this
connector at the matching tag, and a supervisor that can restart it from
Telegram:

```sh
git clone https://github.com/vladtsvirko/dsh-tg-docker-setup
cd dsh-tg-docker-setup
./install.sh            # asks for mode, port, bind address, provider, key,
                        # bot token, allowed ids, admin id, git author
```

`./install.sh --check` prints the whole plan and changes nothing. The setup
pins the connector tag to its own `VERSION`, so the two never drift.

Installing by hand into an existing runtime works too, but pin the tag and grant
the build script, or the install aborts before any code exists:

```sh
# 1. allow the git package's build (its `prepare` compiles src/ into lib/)
cat >> "$DSH_HOME/profiles/web/pnpm-workspace.yaml" <<'YAML'
allowBuilds:
  dsh-telegram-connector@https://github.com/vladtsvirko/dsh-telegram-connector.git: true
YAML

# 2. add the plugin at an exact tag — the one equal to the setup VERSION
dsh plugin --profile web add github:vladtsvirko/dsh-telegram-connector#v0.2.1-rc.5-0.10.6

# 3. token in the environment, never in the YAML
export DSH_TELEGRAM_BOT_TOKEN='123456:ABC…'
```

The package is a plugin bundle: `cordis.patch.yml` mounts one row. Installing
from git runs the package's `prepare` build; pnpm ≥ 10 refuses that build until
the `allowBuilds` entry above exists (pnpm prints the exact key). Restart the
runtime after adding the plugin.

## Configuration

Environment:

| Variable | Meaning |
|---|---|
| `DSH_TELEGRAM_BOT_TOKEN` | main bot token (polling, buttons, topic creation) |
| `DSH_TELEGRAM_PUBLISHER_TOKENS` | optional comma-separated send-only bot tokens |
| `DSH_TIMEZONE` | default zone for parsing typed times (`/timezone` overrides) |
| `DSH_ADMIN_USER_ID` | the one account allowed to change the deployment; unset falls back to the control-chat owner |
| `DSH_UPDATER_TOKEN` / `DSH_UPDATER_URL` | bearer token and endpoint for `/system update setup`, `manage`, `firewall`. The entrypoint/installer sets the token; the URL defaults to `http://updater:8787` (the native install writes `http://127.0.0.1:8787`) |
| `DSH_SUPERVISOR_URL` / `DSH_SUPERVISOR_TOKEN` | set by the deployment's entrypoint; absent outside it |
| `DSH_HOME` | state directory (`bindings.json`, `update/`); defaults to the runtime's home |
| `DSH_WORKSPACE` | workspace root used when `workspaceRoot` is unset |
| `DSH_PORT` | used to build the `/web` link; defaults to `4310` |
| `DSH_PROVIDER` / `DSH_PROVIDER_API_KEY_ENV` | default provider for new sessions and the variable holding its key |

Plugin row:

| Key | Default | Meaning |
|---|---|---|
| `botToken` | `$DSH_TELEGRAM_BOT_TOKEN` | BotFather token |
| `allowedUserIds` | `[]` | Telegram user ids allowed to drive the bot; empty refuses everyone |
| `adminUserId` | control-chat owner, else any allowed user | the one account allowed to run `/system` (except `status`), plugin mutations, `/workspace`, `/bind`, `/system takechat` |
| `requestTimeoutSeconds` / `downloadTimeoutSeconds` | `60` / `120` | HTTP timeouts (seconds) for one Bot API call and one media download |
| `workspaceRoot` | `$DSH_WORKSPACE`, else `$DSH_HOME/workspace` | where `/workspace new` creates directories |
| `provider` / `model` | profile default | model route for new sessions |
| `editIntervalMs` | `1200` | minimum spacing between streaming edits |
| `processMode` | `live` | `live` edits a process card during the turn and collapses it at the end; `summary` sends only the collapsed summary; `off` hides process rows |
| `pollTimeoutSeconds` | `25` | long-poll timeout |
| `reconcileIntervalSeconds` | `60` | UI → Telegram reconciliation period; `0` disables |
| `agentPreset` | DSH default | preset mounted in new Telegram sessions (tools live there); existing sessions keep the preset recorded in their header |
| `reactionsEnabled` | `true` | master switch for read/streaming/staged reactions |
| `readReaction` | `👀` | emoji set on a prompt when the bot reads it; `""` disables it |
| `streamingReaction` | `✍` | emoji set on a reply while it is being edited; `""` disables it |
| `stagedReaction` | `🙉` | emoji set on media staged until a caption or text prompt; `""` disables it |

State lives in `$DSH_HOME/telegram-connector/bindings.json` (atomic writes).
`/reactions` writes the same file, so an online change survives a restart and
takes precedence over the plugin row. Telegram only accepts its own reaction
emoji — `/reactions allowed` lists them; `✓`, `✅` and `⏳` are not accepted.

Set at least `allowedUserIds` in the mounted plugin row — the default refuses
everyone, including you. For a refused **text** message the bot replies with the
sender's numeric id, which is the easiest way to find it (media and commands get
no echo of the id).

Defaults when a key is unset: `adminUserId` → the control-chat owner, else any
allowlisted user; `provider`/`model` → the profile default; `workspaceRoot` →
`$DSH_WORKSPACE`, else `$DSH_HOME/workspace`; `processMode` → `live`.

## First run

1. Open a private chat with the bot and send `/start`. That chat becomes the
   **control chat** (one per runtime; it is where notices appear).
2. `/workspace new web-app` — creates the directory, registers the workspace in
   DSH and prints a `t.me/…?startgroup=workspace_<id>` link.
3. Tap the link and pick a group. Telegram adds the bot and delivers
   `/start workspace_<id>`; the group is bound and the dashboard is posted.
4. Enable **Topics** in the group and give the bot admin rights with
   *Manage Topics* if you have not already.
5. In General: `/new` starts a session. Or create a topic by hand — the first
   plain message in it creates the session.
6. Optional but recommended: create one empty topic and send `/dashboard` in it.
   Commands move there; session topics then take plain text only.

## Commands

The bot is self-documenting: `/help` lists the commands for the current chat,
`/man` prints the full manual, and `<command> --help` explains one command
(including subcommands: `/plugin add --help`). The same text is in
[`docs/COMMANDS.md`](docs/COMMANDS.md). A `<session>` argument accepts a full
session id, an id prefix, or the topic title.

### Control chat (private)

| Command | Effect |
|---|---|
| `/workspaces` | list workspaces, their groups and links (a link only for a group-less workspace) |
| `/workspace new <title>` | create directory + workspace, print the group link |
| `/workspace link <name>` | print the group link again |
| `/workspace rm <name>` | unregister from DSH, delete the binding and the group's session topics (files and sessions are untouched) |
| `/plugins` | list the profile's bundles: enabled, disabled, available |
| `/plugin info <name>` | version, source, rows, overrides and any error |
| `/plugin add <spec>` | inspect a package, then install it after `/plugin confirm` |
| `/plugin enable <name>` · `/plugin disable <name>` | select or deselect a bundle (confirmed like the rest) |
| `/plugin remove <name>` | uninstall a bundle (asks for confirmation) |
| `/plugin confirm` · `/plugin cancel` | finish or drop a pending install/removal |
| `/plugin approve` | allow the install scripts pnpm blocked, and retry |
| `/system restart` | restart into a trial: the new state is live, with a rollback window |
| `/system restart now` | restart without a trial; the current state becomes the rollback point |
| `/system update connector` | reinstall the pinned connector, in a trial |
| `/system update connector now` | reinstall without a trial |
| `/system update setup [--i-know-versions-are-incompatible]` | confirm, drain, then update setup through the updater service |
| `/system confirm` | commit the running trial (or press **Commit**) |
| `/system rollback` | restore the last committed state and restart |
| `/system cancel` | abandon a pending update and unblock the bot; after acceptance it stops the updater job |
| `/system components` | optional components (e.g. the design stack): a card with Enable/Disable/Port buttons |
| `/system status` | versions, supervisor, open trial, web/key/registry probes |
| `/system takechat` | make this chat the control chat (notices and update reports follow it) |
| `/firewall` | native only: whether ufw lets the web UI through, and the `/firewall allow <port>` fix |
| `/web` | a signed link into the web UI for the same sessions |
| `/timezone [zone]` | IANA zone used to read times you type (default `$DSH_TIMEZONE` or UTC) |
| `/reactions …` | read/streaming/staged reactions: show, set, `on`/`off`, `reset`, `allowed` |
| `/status` | model route, counts, poller, timezone, supervisor and probe lines |
| `/system status` | connector, runtime and updater state |
| `/help` · `/man` | index, or the full manual |

Plugin commands run in the private chat because they change the whole profile,
not one workspace. `/schedules` is still a stub.

### Dashboard (General, or the `/dashboard` topic)

| Command | Effect |
|---|---|
| `/new [title]` | mint a session and create its topic |
| `/sessions` · `/status` | dashboard; `/status <session>` shows one session |
| `/dashboard` | make this empty topic the command surface |
| `/sync` | adopt sessions created in the web UI: topic + history per session |
| `/archived` | archived sessions and whether they have a topic |
| `/unarchive <id\|all>` | restore archived sessions, create topics |
| `/rename <session> <title>` | rename session and topic |
| `/model <session> <provider>/<model>` | per-session model route |
| `/close <session>` · `/reopen <session>` | archive/unarchive and close/reopen the topic |
| `/forget <session>` | drop the binding; session and topic stay |
| `/unbind` | detach the group and delete its session topics |
| `/dangerous cleanup [confirm]` | delete known topics that are not sessions |

### Session topic

| Command | Effect |
|---|---|
| plain text | a turn in this session |
| `/commands` · `/skills` | list the live host-command and user-skill catalogs |
| `/<name>` | load a user-invocable skill into the next turn |
| `/run <command> [args]` | run a host command even when a connector name wins |
| `/skill <name> [args]` | load a skill even when a host command owns the name |
| `//text` | send a prompt that literally starts with `/` |
| `/help` · `/man` | the session command manual |

Management lives in the dashboard: `/new`, `/sessions`, `/status`, `/dashboard`,
`/sync`, `/archived`, `/unarchive`, `/rename`, `/model`, `/close`,
`/reopen`, `/forget`, `/unbind`, `/dangerous cleanup`. The session-taking ones
(`/status <session>`, `/rename`, `/model`, `/close`, `/reopen`, `/forget`) take
the session as an argument; a session topic is for talking, not configuring.
Only a leading non-whitespace `/` starts a command; slashes later in the text
are literal.

An unbound group accepts `/bind <workspace id|title>`.

## How sync works

DSH state is the truth; Telegram follows it.

- Workspace renamed in the UI → group title follows within
  `reconcileIntervalSeconds`.
- Group renamed by hand → workspace renamed in DSH.
- Topic renamed by hand → session title updated (and pushed to a live agent
  through the session-title service, when present).
- Topic closed/reopened by hand → session archived/unarchived.
- A workspace deleted in the UI → notice in the control chat; the group is left
  alone, since only a human can delete a group.
- Conversations you drive in the web UI are mirrored into the bound topic
  (one-way) while the connector is not driving that topic. Only your prompts and
  the assistant's answers are posted — harness-injected context (time readings,
  runtime context, skill catalogs) is not, and the prompt/answer pair keeps its
  order even when Telegram is rate-limiting. A mirrored turn streams through the
  same sink as a Telegram one (edits, splitting, the rich/HTML fallback) but has
  no process card — you are watching the process in the web UI.

`/sync` is the explicit adoption step. For every session in the workspace it
decides once: archived → skip; bound → probe the topic with a message send and
delete it, keeping the binding if it answers and dropping it if not; otherwise
create a topic, bind it, and replay the last 20 messages as one transcript. It
is safe to run repeatedly — the second run reports `adopted 0`.

Topics are created last-session-first, so the group reads top-to-bottom in the
workspace's order. That is a snapshot: Telegram orders the topic list by recency
and offers no reorder method, so it can drift as topics see activity.

## Switching between the web UI and Telegram

Both surfaces attach to the same runtime, the same `DSH_HOME` and the same
session store — there is no export step and no second copy of a conversation.

- **Telegram → browser.** `/web` prints a signed link into the web UI for the
  same sessions (bot chat only; treat the link as a password). A session started
  with `/new` is an ordinary DSH session, so the UI lists it.
- **Browser → Telegram.** A session created in the UI has no topic until
  `/sync` in the group adopts it. After that, prompts you send in the browser
  are mirrored into the topic (one-way) and answers appear in both places.
- **Handing one session over.** A session has one live agent. If a browser tab
  holds the session's write handle, a Telegram prompt is refused, the message is
  journaled, and the bot offers **↪️ Take over (restarts dsh)**. The button asks
  for confirmation, then restarts the runtime, which releases *every* handle
  (not just this session's) and delivers the queued prompt. Closing the tab is
  the cheaper move; `/system restart now` does the same thing by hand.
- **Forcing a handover.** Both `/system restart now` and the confirmed **Take over**
  button are admin-only: they restart the whole runtime. Once the tab releases
  the session, any allowlisted member can continue it in Telegram — sessions are
  shared per topic, not per user.

## Behaviour notes

- **Restart.** Bindings load at startup and agents are created lazily, so an
  idle restart is free. A topic bound to an existing session resumes it rather
  than minting a new one.
- **One live agent per session.** If a web UI tab owns a session, a prompt from
  Telegram fails with a readable message instead of hijacking it.
- **Rate limits.** Telegram allows roughly 20 messages/minute **per bot** per
  group and about one message/second per chat. Every outgoing message goes
  through one outbox per group: FIFO (control notices jump), persisted one small
  file per item, paced per bot. When the queue waits, the dashboard topic carries a
  single editable line (`⏳ Telegram rate limit — N queued…`); when every bot is
  saturated, the owner gets a weekly digest instead of silence. Streaming edits
  use a separate budget and are owned by the bot that sent the message.
  `/sync` announces its own wait in the dashboard chat with
  `sync is rate-limited by telegram api, waiting for rate-limit to proceed, please wait`.

  **Exactly-once:** a send that Telegram accepted and acknowledged is removed
  from the queue and never repeated. The unavoidable window is a process death
  between Telegram accepting and the acknowledgement; those items are moved to
  `outbox/<chat>/lost/` rather than retried, so a reply is never duplicated — it
  can be missed, and the owner gets a notice in the bot chat (once per group per
  minute) naming the group and topic so it can be resent from the transcript,
  plus a count for anything the throttle suppressed.
- **Crash catch-up.** Turns and prompts pass through a small journal (the logical
  bridge). If the process dies before a turn is acknowledged, the next boot posts
  one “while the connector was away” digest per session; pending prompts are
  re-injected. The digest is queued before its journal entry is retired, so it is
  never duplicated; a re-injected prompt can be duplicated in the crash window.
- **Publisher bots.** `DSH_TELEGRAM_PUBLISHER_TOKENS` is a comma-separated list
  of extra bot tokens. They are send-only: add each to every workspace group as
  a member (the Bot API cannot do that for you). The main bot checks membership
  every six hours and reports a missing publisher in that group's dashboard topic.
  Publisher messages are ignored as input, so they never feed the agent.
- **Rendering.** Agent Markdown is sent as a Telegram rich message; headings and
  lists render natively, while every table is rewritten to a monospaced code
  block (or a bullet list when too wide) because not every client renders GFM
  tables. If the API rejects rich content, a small HTML subset takes over, and a
  rejected entity falls back to plain text. Answers are split above ~3400
  characters (`SAFE_LENGTH`), on fences and tables (a split table repeats its
  header).
- **More than one bot.** Optional publisher bots multiply the group ceiling
  (20 messages/minute per bot). The main bot polls and owns buttons; publishers
  post, and the switcher picks whichever has headroom. One outbox per group keeps
  the queue in order, shows a single status line while it waits, and reports
  saturation to the owner.
- **Time is yours.** Deadlines and reminders are sent as Telegram `<tg-time>`, so
  every client renders them in its own zone; logs and stored state stay UTC.
  Times you type — schedules, later — are read in the bot's configured zone
  (`/timezone`, `$DSH_TIMEZONE`, default UTC).
- **Self-update.** `/system update connector` asks the supervisor to stop the
  runtime, run the entrypoint's `reset-plugin` (the same path that installed the
  connector), and start it again inside a trial. `now` skips the trial. A failed
  reinstall restores the previous state before the runtime comes back, so a bad
  profile update cannot strand the bot. It reinstalls the **pinned** connector;
  moving the setup tag is `/system update setup`, which confirms, drains agents and
  uses the updater sidecar. `/system rollback` restores the profile, not the
  image.
- **Supervised restarts.** The runtime runs under a supervisor
  that owns modifications to the profile and keeps a copy of it. It is the only
  process that does not load plugins, so a plugin that breaks startup cannot take
  the way back with it. A confirmed plugin change opens a trial *before* it is
  applied: live under HMR, or around a restart when the manager asks for one.
  The trial message carries **Commit** and **Roll back** buttons; it rolls back
  on a crash, on a boot that never checks in, or when the window closes, and a
  container restart inside the window resumes it. A plain restart announces itself on the next boot (`✅ back up …`),
  and the Telegram offset is written before any restart, so the command cannot be
  redelivered and run twice. Without a supervisor the commands say so and point
  at the host.
- **Errors** from the agent are posted in the topic that caused them.

## The web UI and Telegram must agree

Both surfaces show the same runtime, from different records: the web UI lists the
runtime's **workspace registry**, Telegram lists the connector's **bindings**.
They can disagree after a crash during a registry write, after an upgrade that
reset the storage domain, or after a boot under a different `DSH_HOME` — the bot
still names the workspace and its topics, the web UI shows nothing, and a prompt
has nowhere to land.

The connector repairs that instead of reporting it. At boot it recreates a bound
workspace whose directory still exists (under the id the registry issues, moving
the binding and its sessions with it), re-attaches the sessions the workspace
lost, and posts one line in the control chat. `/sync` does the same on demand,
and `/system status` shows both counts before a prompt can fail:

```
registry: 2 workspace(s) in the runtime · 2 bound to Telegram
data: /srv/dsh/data · this runtime (native)
```

The `data` line names a second live runtime over the same directory
(`⚠ another runtime holds it (pid …, since …)`) — the one failure a
restart cannot clear, because that process keeps the kernel lock on every
session it has open.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `⛔ You are not authorized` with an id | add that id to `allowedUserIds` |
| bot ignores plain messages in topics | privacy mode is on — BotFather → `/setprivacy` → Disable |
| `could not create the session topic` | bot is not admin, or lacks *Manage Topics* |
| `/sync` reports `adopted 0` | every session is archived, already bound to a live topic, or the workspace id does not match — check `/archived` and the dashboard |
| `this session is held by another client` | something owns the session's write handle; the refusal says which. **Another topic of this group** already runs it — send there, or `/forget` this binding (no restart helps). **A web UI tab** — the message is queued; **Take over** asks, then restarts dsh and releases every handle. **Another dsh process** over the same data directory — stop it first (`sudo systemctl stop dsh.service`); a restart of this runtime cannot clear its lock, and `./install.sh --doctor` names it |
| nothing happens after adding the plugin | token is empty — the connector logs a warning and stays idle |
| group title never follows a rename | bot lacks *Change Info* in that group |
| `this runtime exposes no plugin manager` | the profile is not base-backed, or `@deepseek-ai/dsh-plugin-manager` is not mounted |
| `/plugin add` says *already installed* | updates are a removal plus an install; use the host CLI, or remove first |
| a plugin change says *restart required* | this runtime has no HMR — `/system restart`, then `/system confirm` if it works |
| `/system restart` says *not running under the supervisor* | the runtime was started directly (no container), so restart it from the host |

## Security

- `allowedUserIds` is the gate for **using** the bot, and `adminUserId` is the
  gate for changing the deployment (`/system restart|update|rollback`, plugin
  mutations, `/workspace` and `/bind`). An empty allowlist means nobody, not
  everybody. When `adminUserId` is unset, the control-chat owner is admin, and
  otherwise any allowlisted user can run admin commands.
- The bot token comes from the environment; `cordis.patch.yml` never carries it.
- The bot is an admin of its groups and can delete topics. `/dangerous cleanup`
  requires an explicit `confirm`; `/forget` never deletes anything.
- **Plugins execute host code.** `/plugin add` inspects first and installs only
  after `/plugin confirm`; blocked install scripts need `/plugin approve`, which
  names exactly the packages allowed. The connector refuses to remove or disable
  itself, since that would cut the line mid-command.
- `bindings.json` contains chat ids and session ids, not message contents.

## Development

```sh
npm install
npm run build       # tsc → lib/
npm test            # vitest: render, bindings, plugins, supervisor, delivery, …
npm run typecheck
```

`src/index.ts` is the plugin (routing, commands, streaming); `help.ts` is the
command registry behind `/help`, `/man` and the Telegram command menu;
`telegram.ts` is the typed Bot API client; `render.ts` normalises rich Markdown
and splits; `outbox.ts` owns the per-group queue and publishers; `bindings.ts`
persists the mapping; `sessions.ts` owns the topic key model; `bridge.ts` is the
turn journal; `mirror.ts` mirrors web-UI turns; `plugins.ts` reads the host's
plugin manager and renders its answers; `supervisor.ts` talks to the container
supervisor over its loopback socket. [CONTRIBUTING.md](CONTRIBUTING.md) has the
full module table.

## License

MIT
