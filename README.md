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
 ├── General (or your /setsystem topic)   dashboard: /new, /sync, session admin
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
  creates a topic for each and replays the tail of the conversation. Renaming,
  archiving and unarchiving round-trip in both directions.
- **Streaming replies.** One message per turn, edited in place as the model
  writes. Telegram rich messages render Markdown tables, headings and lists
  natively; if the API rejects them, the connector falls back to an HTML table
  (or a key/value list) and finally to plain text. Splitting is fence- and
  table-aware.
- **Read and streaming reactions.** The bot reacts 👀 to a prompt when it reads
  it, and ✍ to a reply while it is still being edited; the streaming reaction is
  removed when the turn settles. Change either emoji online with `/reactions`
  (Telegram's fixed reaction set is validated).
- **Commands live in one place.** A dashboard topic holds `/new`, `/sync`,
  `/close`, `/rename`, `/model` and friends; session topics accept plain text.
- **Plugins from the chat.** `/plugins` lists the profile's bundles, `/plugin add`
  inspects a spec before anything runs and asks for a confirmation, and
  `enable`/`disable`/`remove` work without opening a terminal.
- **Host-free after install.** In the Docker image the runtime runs under a
  supervisor: every plugin confirmation opens a rollback window (live under HMR,
  or around a restart), and `/system update connector` reinstalls the pinned
  connector the same way. `/system update all` drains agents and moves the whole
  setup through the updater sidecar. The trial comes with Commit / Roll back
  buttons; ignore it and it rolls back by itself. A dead runtime, a dead updater,
  a broken `.env` or Docker itself still needs the host — that boundary is
  documented in the setup repo's
  [LIMITS.md](https://github.com/vladtsvirko/dsh-tg-docker-setup/blob/main/docs/LIMITS.md).
- **Durable.** Bindings survive restarts, sessions are resumed, not recreated.
- **Allowlisted.** Only Telegram user ids you list can drive the bot.

## Status

Built and tested against DSH `0.2.1-rc.2`; unit tests for rendering, reactions,
bindings and the plugin surface, `tsc --noEmit` clean.

| Part | State |
|---|---|
| Bot API client (`src/telegram.ts`) | done — topics, titles, close/reopen, deletes |
| Rendering (`src/render.ts`) | done — rich Markdown with native tables, HTML/plain fallbacks, fence- and table-aware split |
| Bindings (`src/bindings.ts`) | done — atomic JSON, v2 schema |
| Control plane, groups, topics, streaming | done |
| Sync: workspace ⇄ group, session ⇄ topic, archive ⇄ close | done |
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

```sh
dsh plugin --profile web add github:vladtsvirko/dsh-telegram-connector
```

The package is a plugin bundle: `cordis.patch.yml` mounts one row. Put the token
in the environment (never in the YAML):

```sh
export DSH_TELEGRAM_BOT_TOKEN='123456:ABC…'
```

Installing from git runs the package's `prepare` build; pnpm ≥ 10 may ask you to
allow that build step. Restart the runtime after adding the plugin.

## Configuration

Environment:

| Variable | Meaning |
|---|---|
| `DSH_TELEGRAM_BOT_TOKEN` | main bot token (polling, buttons, topic creation) |
| `DSH_TELEGRAM_PUBLISHER_TOKENS` | optional comma-separated send-only bot tokens |
| `DSH_TIMEZONE` | default zone for parsing typed times (`/timezone` overrides) |
| `DSH_SUPERVISOR_URL` / `DSH_SUPERVISOR_TOKEN` | set by the Docker entrypoint; absent outside it |

Plugin row:

| Key | Default | Meaning |
|---|---|---|
| `botToken` | `$DSH_TELEGRAM_BOT_TOKEN` | BotFather token |
| `allowedUserIds` | `[]` | Telegram user ids allowed to drive the bot; empty refuses everyone |
| `workspaceRoot` | `$DSH_WORKSPACE`, else `$DSH_HOME/workspace` | where `/workspace new` creates directories |
| `provider` / `model` | profile default | model route for new sessions |
| `editIntervalMs` | `1200` | minimum spacing between streaming edits |
| `pollTimeoutSeconds` | `25` | long-poll timeout |
| `reconcileIntervalSeconds` | `60` | UI → Telegram reconciliation period; `0` disables |
| `agentPreset` | DSH default | preset mounted in new Telegram sessions (tools live there); existing sessions keep the preset recorded in their header |
| `reactionsEnabled` | `true` | master switch for read/streaming reactions |
| `readReaction` | `👀` | emoji set on a prompt when the bot reads it; `""` disables it |
| `streamingReaction` | `✍` | emoji set on a reply while it is being edited; `""` disables it |

State lives in `$DSH_HOME/telegram-connector/bindings.json` (atomic writes).
`/reactions` writes the same file, so an online change survives a restart and
takes precedence over the plugin row. Telegram only accepts its own reaction
emoji — `/reactions allowed` lists them; `✓`, `✅` and `⏳` are not accepted.

Set at least `allowedUserIds` in the mounted plugin row — the default refuses
everyone, including you. The bot replies with the sender's numeric id to any
refused message, which is the easiest way to find it.

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
6. Optional but recommended: create one empty topic and send `/setsystem` in it.
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
| `/workspaces` | list workspaces, their groups and links |
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
| `/system update all [--i-know-versions-are-incompatible]` | drain sessions, then update setup through the updater sidecar |
| `/system confirm` | commit the running trial (or press **Commit**) |
| `/system rollback` | restore the last committed state and restart |
| `/timezone [zone]` | IANA zone used to read times you type (default `$DSH_TIMEZONE` or UTC) |
| `/status` | runtime, workspace and session counts |
| `/about` | connector, runtime and updater state |
| `/help` · `/man` | index, or the full manual |

Plugin commands run in the private chat because they change the whole profile,
not one workspace. `/schedules` is still a stub.

### Dashboard (General, or the `/setsystem` topic)

| Command | Effect |
|---|---|
| `/new [title]` | mint a session and create its topic |
| `/sessions` · `/status` | dashboard; `/status <session>` shows one session |
| `/setsystem` | make this empty topic the command surface |
| `/sync` | adopt sessions created in the web UI: topic + history per session |
| `/list archived` | archived sessions and whether they have a topic |
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
| `/help` · `/man` | only these two commands are answered here |

Everything else — `/status <session>`, `/rename`, `/model`, `/close`, `/reopen`,
`/forget`, `/dangerous cleanup` — lives in the dashboard with the session
argument. A session topic is for talking, not configuring.

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
  order even when Telegram is rate-limiting.

`/sync` is the explicit adoption step. For every session in the workspace it
decides once: archived → skip; bound → probe the topic with a message send and
delete it, keeping the binding if it answers and dropping it if not; otherwise
create a topic, bind it, and replay the last 20 messages as one transcript. It
is safe to run repeatedly — the second run reports `adopted 0`.

Topics are created last-session-first, so the group reads top-to-bottom in the
workspace's order. That is a snapshot: Telegram orders the topic list by recency
and offers no reorder method, so it can drift as topics see activity.

## Behaviour notes

- **Restart.** Bindings load at startup and agents are created lazily, so an
  idle restart is free. A topic bound to an existing session resumes it rather
  than minting a new one.
- **One live agent per session.** If a web UI tab owns a session, a prompt from
  Telegram fails with a readable message instead of hijacking it.
- **Rate limits.** Telegram allows roughly 20 messages/minute **per bot** per
  group and about one message/second per chat. Every outgoing message goes
  through one outbox per group: FIFO (control notices jump), persisted one small
  file per item, paced per bot. When the queue waits, the system topic carries a
  single editable line (`⏳ Telegram rate limit — N queued…`); when every bot is
  saturated, the owner gets a weekly digest instead of silence. Streaming edits
  use a separate budget and are owned by the bot that sent the message.
  `/sync` announces its own wait in the system chat with
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
  every six hours and reports a missing publisher in that group's system topic.
  Publisher messages are ignored as input, so they never feed the agent.
- **Rendering.** Agent Markdown is sent as a Telegram rich message, so tables,
  headings and lists render natively. If the API rejects rich content, a small
  HTML subset takes over: tables become a monospaced block or a key/value list,
  and a rejected entity falls back to plain text. Answers over ~3800 characters
  are split on fences and tables (a split table repeats its header).
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
  moving the setup/image tag is `/system update all`, which drains agents and
  uses the updater sidecar. `/system rollback` restores the profile, not the
  image.
- **Supervised restarts.** The Docker image runs the runtime under a supervisor
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

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `⛔ You are not authorized` with an id | add that id to `allowedUserIds` |
| bot ignores plain messages in topics | privacy mode is on — BotFather → `/setprivacy` → Disable |
| `could not create the session topic` | bot is not admin, or lacks *Manage Topics* |
| `/sync` reports `adopted 0` | every session is archived, already bound to a live topic, or the workspace id does not match — check `/list archived` and the dashboard |
| `this session is open elsewhere` | a web tab owns it; close it there or start a new session with `/new` |
| nothing happens after adding the plugin | token is empty — the connector logs a warning and stays idle |
| group title never follows a rename | bot lacks *Change Info* in that group |
| `this runtime exposes no plugin manager` | the profile is not base-backed, or `@deepseek-ai/dsh-plugin-manager` is not mounted |
| `/plugin add` says *already installed* | updates are a removal plus an install; use the host CLI, or remove first |
| a plugin change says *restart required* | this runtime has no HMR — `/system restart`, then `/system confirm` if it works |
| `/system restart` says *not running under the supervisor* | the runtime was started directly (no container), so restart it from the host |
| `/system update connector` needs `DSH_TELEGRAM_PLUGIN` | the entrypoint uses that ref to reinstall; set it in `.env` (the example does) |

## Security

- `allowedUserIds` is the only gate. Empty means nobody, not everybody.
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
npm test            # vitest: render, bindings, plugins, supervisor, telegram
npm run typecheck
```

`src/index.ts` is the plugin (routing, commands, streaming); `telegram.ts` is
the typed Bot API client; `render.ts` handles Markdown and splitting;
`bindings.ts` persists the mapping; `sessions.ts` owns the topic key model;
`plugins.ts` reads the host's plugin manager and renders its answers;
`supervisor.ts` talks to the container supervisor over its loopback socket;
`time.ts` validates the stored zone.

## License

MIT
