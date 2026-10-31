# dsh-telegram-connector — design

Telegram is a **control plane and projection** of one DeepSeek Harness runtime.
This document records the mapping, the source-of-truth rules and the constraints
the Telegram API forces on the design.

## 1. Mapping

The mapping follows DSH's own containment hierarchy instead of flattening it:

```
private chat with the bot        control plane
  /workspaces  /workspace …      configuration, never conversation

group  "web-app"                 one Workspace
 ├── General                     workspace dashboard (or the /setsystem topic)
 ├── session-9cb8…               one Session
 └── session-2f41…               one Session

group  "landing-page"            another Workspace
 └── …
```

| Telegram | DSH object | Authoritative |
|---|---|---|
| Private chat with the bot | control plane | connector |
| Group | `Workspace` (id, path, title) | DSH |
| Topic in that group | `Session` (id, title, model) | DSH |
| General topic, or a topic claimed with `/setsystem` | workspace dashboard | connector |
| Message in a session topic | a turn in that session | session log |

## 2. Source of truth

**DSH state is truth; Telegram is a projection of it.** Configuration is
initiated in the private chat; conversations happen in group topics.

- Workspace renamed in the UI → group renamed (`setChatTitle`).
- Group renamed by hand → `workspaceController.rename`.
- Session archived in the UI → no automatic close yet (see §16, *open*);
  `/close` does both, and closing the topic by hand archives the session.
- Workspace deleted in the UI → notice in the control chat; the group is left
  alone, because only a human can delete a group.

Renames are never confirmed: a control panel does not argue with its backend.

## 3. Object model

`$DSH_HOME/telegram-connector/bindings.json`, atomic writes:

```jsonc
{
  "version": 2,
  "controlChatId": 123456789,
  "lastUpdateId": 401123456,
  "workspaces": {
    "<workspaceId>": {
      "chatId": -1001234567890,
      "path": "/data/workspace/web-app",
      "title": "web-app",
      "systemThreadId": 21,          // absent → General
      "seenThreads": [21, 35, 41]    // topic ids this group has shown us
    }
  },
  "sessions": {
    "-1001234567890:35": {
      "workspaceId": "…",
      "sessionId": "session-…",
      "title": "fix the checkout form",
      "model": { "provider": "deepseek-official", "model": "deepseek-v4-flash" }
    }
  }
}
```

- `chatId: 0` means "known workspace, no group yet".
- Session keys are `<chatId>:<threadId>`; the General topic (`threadId = 0`) is
  never a session.
- `seenThreads` exists because Telegram has no "list topics" method. It is the
  bot's only inventory, and it is why `/dangerous cleanup` can only remove
  topics the group has shown since the bot joined.
- `lastUpdateId` prevents replaying the update queue after a restart.
- The session id is minted when the topic is created and adopted by the agent on
  the first message, so a topic has a stable identity before any model call.

## 4. Onboarding

A bot **cannot create a group**, and cannot enable Topics (a human-only group
setting). So the flow is deliberately asymmetric:

| Object | Who creates it |
|---|---|
| Workspace | `/workspace new <title>` in the control chat (directory + DSH registry) |
| Group | you, via the one-tap link the bot prints (`?startgroup=workspace_<id>`) |
| Topics (sessions) | the bot (`createForumTopic`) from `/new`, or you by hand |

When the bot is added through the link, Telegram delivers `/start workspace_<id>`
inside the new group; that message is the binding handshake. Binding a group
clears whatever session topics the group held before, so a group always maps to
exactly one workspace.

Group requirements: **Topics enabled**, bot **admin** with *Manage Topics* (and
*Change Info* for title sync), **privacy mode off** so plain topic messages are
visible. Missing rights are logged once and topic operations degrade to a clear
message, never a retry storm.

## 5. Commands

The full reference lives in the README; the shape is what matters here.

- **Control chat** — `/workspaces`, `/workspace new|link|rm`, `/plugins`,
  `/plugin info|add|enable|disable|remove|confirm|cancel|approve`, `/status`.
- **Dashboard** — `/new`, `/sessions`, `/status`, `/setsystem`, `/sync`,
  `/list archived`, `/unarchive`, `/rename`, `/model`, `/close`, `/reopen`,
  `/forget`, `/unbind`, `/dangerous cleanup`.
- **Session topic** — plain text is a turn; `/help` and `/man` are the only
  accepted commands (you need to be able to ask where the commands are). Every
  management command takes the session as an argument in the dashboard, so a
  conversation never has to be command-aware.

`/setsystem` can only claim a topic that holds no session, which is what lets a
hand-made empty topic become the dashboard. General is the fallback.

### Plugin surface

Plugin management is profile-global, so it lives in the control chat rather than
a workspace topic, and it rides on the host's `pluginManager` service:

| Step | Host call |
|---|---|
| `/plugins` | `listBundles()` |
| `/plugin info <name>` | `listBundles()`, matched by name, title or scope-less name |
| `/plugin add <spec>` | `inspect(spec)` — no mutation |
| `/plugin confirm` | `installBundle(spec)` |
| `/plugin approve` | `installBundle(spec, { approvedBuilds })` |
| `/plugin enable\|disable <name>` | `setBundleEnabled(name, boolean)` |
| `/plugin remove <name>` | `removeBundle(name)` |

The confirmation gate is deliberate: a plugin runs in-process with the
runtime's permissions, so the preview lists what the spec names and the
confirmation is bound to the user who started it and expires after ten minutes.
The preview also states what the change costs: without HMR it says the runtime
will restart and that the new state only survives a `/system confirm`; enabling and
disabling a bundle goes through the same confirmation for that reason. When the
manager reports `restart-required`, the connector does not hand the restart back
to the user — it starts the trial itself, and the trial message is the second
confirmation.
pnpm's blocked install scripts are named, and only `/plugin approve` allows the
exact packages the failed run reported. The connector refuses to disable or
remove its own bundle, because the in-flight reply would be cut off. A missing
manager is reported, never assumed.

Results are reported as the manager states them: `applied`, `restart-required`
(with the reason), `failed` (with the error code, the last of pnpm's output and
the log path), or `cancelled`. On a runtime without HMR an installation lands as
`restart-required`, which names the restart rather than pretending the plugin is
live.

## 6. Sync

| Event | Result |
|---|---|
| workspace renamed in UI | group title follows within `reconcileIntervalSeconds` |
| group renamed by hand | workspace renamed; the connector records the title first so its own echo is ignored |
| topic renamed by hand | session's cached title updated; a live agent is renamed through the session-title service when present |
| topic closed / reopened by hand | session archived / unarchived |
| workspace has no group | reminder with the startgroup link, once per process |
| workspace deleted in UI | notice in the control chat |
| `/sync` | sessions created in the UI get topics, bindings and a history replay |
| `/unarchive` | archived sessions return as topics |

`/sync` decides **per session** rather than from a precomputed "already known"
set: archived → skip; bound → probe the topic with a real send-and-delete and
keep the binding only if it answers; otherwise create a topic, bind it and
replay the tail. A binding pointing at a deleted topic can therefore never mask
a live session, and a second run reports `adopted 0`.

History replay reads the session log through `sessionQuery.readSession`, drops
harness-injected context (runtime snapshots, per-turn timestamps), quotes both
speakers as a transcript and sends it as **one** message — one message per
session keeps `/sync` inside the ~20 messages/minute group limit.

`/sync` paces its own Telegram calls through a per-chat limiter (about one per
second, twenty per minute per group) instead of discovering the limit through
429s. A 429 is retried after `retry_after`; the first enforced wait is announced
once in the system chat, so a slow sync is visible rather than silent.

Adoption creates the last session of the workspace first. Telegram lists topics
newest first, so this is what makes the group read top-to-bottom in the
workspace's manual order; the order is a snapshot, since Telegram orders the
list by recency and the Bot API has no reorder method (pinning is the only
lever, and it is limited).

## 7. Sessions

One topic = one session, no exceptions.

- Minted on `/new` (dashboard) or on the first message in a hand-made topic.
- Model is per session (`/model`), falling back to the connector config.
- A topic is **never re-assigned**. `/new` exists only in the dashboard and
  always creates both a session and the topic it lives in.
- A session id in `bindings.json` is the topic's identity for life. After a
  restart the connector *resumes* that session (`agents.create` refuses an id
  that is already persisted), so a topic keeps its history across restarts.
- New sessions are attached to their workspace with
  `workspaceRegistry.get(id).attachSession(sessionId)`; without that step the
  session exists with the right cwd but the UI files it under "Ungrouped".
  Attachment is retried at turn end if the session header is not persisted yet.
- **One live agent per session.** If a web UI tab owns it, a Telegram prompt
  gets a readable error instead of a hijack.

## 8. Message pipeline

```
update → allowlist → private? control
                   → group?  workspace by chatId
                            → closed/reopened? archive toggle
                            → system topic? dashboard commands
                            → session topic? agent.followup()
        session/event assistant/message → accumulate → throttled edit
        turn end → final edit
        session/event outside a runtime → mirror into its topic
```

- One message per turn, edited in place, throttle `editIntervalMs` (1.2 s).
- Rendering prefers Telegram **rich messages** (Bot API 10.1+): the agent's
  Markdown is passed to Telegram's own parser, so headings, lists and tables
  render natively. If the API or the content rejects a rich message, the
  connector falls back to the classic HTML subset, where a table becomes a
  monospaced `<pre>` table (or a key/value list when it is too wide). A final
  400 falls back to plain text, never to raw Markdown.
- Splitting is fence-aware and table-aware, ~3800 chars. A split inside a table
  repeats its header and separator, so each chunk still renders as a table.
- Agent context: every Telegram session gets the `telegram-surface` system
  prompt section, and the connector registers the `telegram-rich-text` runtime
  skill from `skills/telegram-rich-text/SKILL.md`. The section tells the model
  that the reader is in Telegram; the skill carries the full syntax cheat sheet
  and is loaded on demand instead of inflating every prompt.
- Reactions: the main bot sets the **read** reaction on an authorized prompt as
  soon as the connector reads it. A streamed reply gets the **streaming**
  reaction on every part that may still be edited; the reaction is removed after
  the final flush at `turn/end`, on `agent/error`, and on shutdown. Both emoji
  are stored in the bindings and changed online with `/reactions`; Telegram's
  fixed reaction set is validated first.
- Attachments: photos and image documents become `ImageBlock`s; documents,
  videos, video notes, audio, voice notes and animations become `FileBlock`s
  through `ctx.attachments`. The connector passes the Telegram caption and file
  metadata as text; DSH gives the agent a read-only file handle, so extraction is
  the agent's job. Captionless media is staged (metadata only) and marked with
  the **staged** reaction; the next caption or text prompt downloads and attaches
  the whole batch. Albums share a `media_group_id` and are debounced for one
  second before staging or prompting. Staged state expires after 15 minutes.
- Replies: a same-chat `reply_to_message` or cross-chat `external_reply` becomes
  a quoted reference block in the prompt. Its media is re-downloaded (no cache),
  deduped against staged/new media by `file_id`, and download errors are written
  into the prompt so the model can suggest re-uploading or granting access.
  A text reply is a normal acknowledgment turn; a media reply is an immediate
  prompt with the new media as the task and the referenced media as context.
- `agent/error` is reported in the same topic.
- Conversations driven from the web UI are mirrored one-way into the bound
  topic while the connector is not driving that topic.

## 9. Persistence and restart

Bindings load at startup; agents are created lazily on the next message, so a
restart costs nothing until someone talks. On shutdown pending edits are
flushed, agents disposed and bindings written. A lost `bindings.json` is
recoverable: the group link rebinds, and DSH still has the workspaces, sessions
and directories.

## 10. Security

- Allowlist only; empty refuses everyone.
- The bot token comes from the environment, never from `cordis.patch.yml`.
- The bot is a group admin and can delete topics: `/dangerous cleanup` requires
  an explicit `confirm`, and `/forget` never deletes anything.
- Plugin mutations are the highest-risk surface: a bundle's code and install
  scripts run with the runtime's permissions. `/plugin add` inspects first and
  installs only after an explicit `/plugin confirm`; blocked install scripts are
  named and only `/plugin approve` allows exactly those names; `/plugin remove`
  confirms too. Enable/disable is immediate and reversible. The connector
  refuses to disable or remove its own bundle.

## 11. Telegram constraints

- Bots cannot create groups or enable Topics; they can create/rename/close/delete
  topics, and rename groups with *Change Info*.
- No method lists topics or history, and a bot never receives its own messages;
  deletion is invisible.
- Topic names ≤ 128 chars, no threads inside topics, 4096 chars per classic
  message, ~20 messages/minute per group, ~1 edit/s per chat. Rich messages
  allow 32768 chars, 500 blocks and 20 table columns; the connector still splits
  at ~3800 so the HTML fallback always fits.
- Reactions are a fixed emoji set, one per bot per message; a bot without the
  right to react simply gets no reaction (the failure is logged once per chat).
- Deleting a topic destroys its history; closing preserves it read-only.
- Service messages from the bot's own actions arrive with the bot's id and are
  dropped by the allowlist; commands therefore perform their archive/bookkeeping
  explicitly rather than relying on the service-message path.

## 12. Supervised restarts

A plugin change on a runtime without HMR ends in `restart-required`, and the
process that would restart is the one the plugin just changed. So the restart
cannot belong to the connector: the deployment runs

```
tini → entrypoint → supervisor (supervisor.mjs) → dsh
```

and the supervisor is the only process that loads no plugins. It owns three
things the connector cannot: the restart, a snapshot of the profile, and a
deadline that survives the runtime.

### State

`$DSH_SUPERVISOR_STATE/state.json` holds one optional trial and the timestamp of
the last committed snapshot; `state/stable/` is a copy of the profile directory.
The snapshot is refreshed at boot, on `/system restart`, and on `/system confirm`. Everything
outside the profile — sessions, the workspace, `bindings.json` — is untouched by
a rollback, which is what makes the swap cheap and safe.

### Flow

| Step | Who | Effect |
|---|---|---|
| `/system restart` (default) | connector → `POST /restart {trial:true}` | supervisor persists the trial, then restarts `dsh` |
| `/system restart now` | connector → `POST /restart {trial:false}` | supervisor snapshots the current profile, then restarts |
| plugin confirmation | connector → `POST /trial/open` | trial opens *before* the change, without restarting |
| change applied live | connector | keeps the trial; the message is the confirmation |
| change needs a restart | connector → abandon + `/system restart` | the live trial is closed and a restart trial opened |
| `/system update connector` | connector → `POST /update {trial:true}` | supervisor stops the runtime, runs `dsh-entrypoint reset-plugin`, starts a trial |
| `/system update connector now` | connector → `POST /update {trial:false}` | same reset, then commit the new state and start |
| connector boot | `GET /status`, `POST /trial/arm` | first arm sets the deadline; the connector announces it |
| `/system confirm`, **Commit** | `POST /trial/commit` | current profile becomes the stable snapshot |
| `/system rollback`, **Roll back**, crash, timeout | supervisor | stop, restore, start, notify |

The trial message carries an inline keyboard (`trial:commit:<id>` /
`trial:rollback:<id>`), so the confirmation is a button press rather than a typed
command; callbacks are allowlisted like messages, answered with
`answerCallbackQuery`, and matched against the live trial id before anything
happens. The typed commands remain, and the buttons are retired by editing the
message when the trial ends.

The trial can only be confirmed *through the running trial*: the confirmation
arrives as a Telegram message to the connector inside it. If the trial cannot
boot, or its connector cannot load, no confirmation can exist, and the deadline
or the boot timer rolls it back without any outside input. That property, not
the timer, is what makes the rollback reliable.

### Live trials

HMR means a bundle change can land without a restart, but a live change still
deserves the same window. The connector therefore opens the trial *before* the
manager runs the operation:

```
/plugin confirm ─► POST /trial/open ─► mutation ─┬─ applied        ─► keep trial, announce
                                                 ├─ restart-required ─► abandon, restart trial
                                                 └─ failed         ─► abandon
```

Opening before the mutation is the point: an HMR reload that kills the process is
already inside a trial, so the supervisor restores. `POST /trial/abandon` closes
a window without touching the profile, for the case where the change never
landed. The announcement says "the change is live" and carries the same buttons
and deadline.

### Edge cases

- The connector arms the trial only after the runtime is up; arming is therefore
  the health signal. If it never happens, the boot grace expires and the
  supervisor restores.
- If the runtime exits during a trial, the supervisor restarts into the snapshot
  instead of the crash loop it would otherwise enter.
- A container restart inside the window keeps the deadline; an expired deadline
  is restored before the runtime starts.
- A failed `/system update connector` restores the snapshot before restarting, so a registry
  outage or a broken ref leaves the previous connector in place. An interrupted
  update (container restart mid-`reset-plugin`) leaves a half-wiped profile,
  which the open trial then rolls back.
- The connector writes `bindings.lastUpdateId` before it asks the supervisor for
  a restart. Telegram redelivers updates that were never confirmed, and a restart
  command replayed after the restart would restart the runtime a second time.
- Restoring is a directory swap through a staging copy: a failed copy leaves the
  profile as it was, and the old directory is removed only after the new one is
  in place.
- The trial message id is stored in `bindings.json`, so the next boot can retire
  a keyboard left behind by a timeout or by a `/system confirm` typed instead of
  pressed.

### Limits

- The supervisor covers the profile. Changes made directly in `$DSH_HOME` before
  the container starts are outside any trial. Image updates are handled by the
  separate setup updater, with its own image/snapshot rollback, not by a
  supervisor trial.
- The snapshot is a full copy of the profile directory, including
  `node_modules`; a commit costs one copy. That is the price of an offline,
  package-manager-free rollback.
- If the supervisor itself cannot start (bad image, unwritable `/data`), nothing
  here helps; that is what the container healthcheck and the host are for. If the
  container, updater or Docker cannot start, Telegram cannot recover it.

## 13. Time

Three separate concerns, three separate mechanisms:

| Concern | Mechanism |
|---|---|
| Display a deadline or reminder | `<tg-time unix="…" format="r|t">` — the client renders it in the reader's zone |
| Interpret a time the user types | one IANA zone stored in `bindings.json` (`/timezone`, `$DSH_TIMEZONE`, default UTC) |
| Store and compute | epoch milliseconds / UTC everywhere, including supervisor state and logs |

`toTelegramHtml` whitelists exactly that tag (validated `unix` and format), so
the renderer keeps escaping everything else. The fallback text inside the tag is
what clients without support show. No container `TZ` is needed: setting one would
move every timestamp in the runtime, and would still not let two readers see
their own time.

Input has no such client-side luxury: “tomorrow at 9:00” needs one zone before it
can become a UTC instant, which is why the zone is stored rather than derived.
The scheduled-time parser (next surface) reads that value; nothing else may
invent a zone of its own.

## 14. Delivery

Every outgoing message goes through an **outbox per group**; nothing sends
directly except edits of a message already sent and the few control messages
that must carry buttons.

```
producers ─► outbox[chat] ─► scheduler ─► bot pool ─► Telegram
             FIFO, control first          main + publishers
             one file per item            per (bot, chat): 20/min, ~1/s
```

- **Persistence.** One small JSON file per item in
  `$DSH_HOME/telegram-connector/outbox/<chat>/`: `pending-…` while queued,
  renamed to `sending-…` before the call, deleted on acknowledgement. Recovery
  reads the directory; a `sending-…` file is an ambiguous outcome and is moved
  to `lost/` instead of being retried. That is the exactly-once boundary: no
  duplicates, possible loss only in the crash window. A loss is not silent: the
  owner gets a control notice in the bot chat with the group, the topic, a short
  snippet and the reason, throttled to once per group per minute; suppressed
  items are counted in the next notice and in the weekly digest.
- **Priority.** Control notices jump the FIFO; everything else is FIFO. Messages
  with inline buttons are sent by the main bot directly, because callbacks are
  delivered to the sender and only the main bot polls.
- **Bot pool.** `DSH_TELEGRAM_PUBLISHER_TOKENS` adds send-only bots. Each has its
  own 20/minute budget per group; the scheduler picks the first bot with headroom
  and membership, and falls back on 429 or a missing member. Private chats are
  main-only. Membership is re-checked every six hours and reported in the group's
  system topic when a publisher is absent.
- **Edits.** The bot that sends a message owns its edits; a stream is pinned to
  that bot for the turn. Edits have their own per-chat pacing.
- **Visibility.** While the queue is non-empty, one line in the system topic is
  edited in place (`⏳ Telegram rate limit — N queued…`). Saturation events and
  lost messages are bucketed per day; at most once per six hours the owner gets a
  seven-day digest with a suggestion to add a publisher.
- **Filesystem concurrency.** One connector process owns the outbox; each chat
  has its own directory and its worker serialises that chat. Item filenames carry
  a unique id, `pending → sending` is a rename (atomic on a local filesystem),
  and the temp file is fsynced before the rename, so a crash cannot leave a
  half-written item under a live name. Metadata files (`bindings.json`,
  `rate-stats.json`) use per-write unique temp names, fsync and a serialized
  write chain — overlapping writers must never resurrect an older snapshot.
  SQLite was considered and deliberately not adopted: the queue is ~20
  messages/minute, the state is a handful of files, and a native/experimental
  SQLite dependency is more operational risk than a per-item file. If the
  connector ever needs shared state across processes, that trade flips.
- **Limits.** Streaming sends bypass the queue (they need the message id to edit
  in place), so strict FIFO applies to queued messages, not across a live stream.
  A publisher must be added to a group by a human; the Bot API cannot do it.

## 15. Bridge (logical)

The bridge is the boundary between “DSH produced a turn” and “Telegram delivered
it”. It is a module today, with a file format that a separate process could serve
later without changing either side:

```
DSH session/event ──► bridge out/  (turn records, watermarked by deletion)
Telegram prompt   ──► bridge in/   (input records, deleted after injection)
```

- **out/** receives one record per finished turn (assistant text, optional user
  text, timestamp). The live message is still streamed and edited; when the first
  send is acknowledged the record is retired. If the process dies before that,
  the record survives and the next boot posts a single “while the connector was
  away” digest per session, then retires it. The digest is enqueued in the outbox
  *before* retirement, so a crash in between cannot duplicate the catch-up.
- **in/** receives a prompt record before it is handed to the agent, and retires
  it after the hand-off. On boot, pending records are re-injected into their
  session. The crash window here can duplicate one prompt (acknowledge-after-send
  has the same ambiguity as every other send); it is logged, not hidden.
- Both journals are one small file per record, fsynced before rename.
- The bridge has no Telegram code and no formatting; the connector owns rendering,
  rate limits, bots and buttons. Extracting the connector into its own process is
  then a matter of watching these directories instead of calling the module.

What the bridge does **not** cover: turns produced while the plugin itself was
not loaded. Those exist only in the DSH session log; a full watermark over that
log is the next step if that failure mode matters.

## 16. Open

- Automation surface: schedule syntax in the dashboard topic.
- Plugin rows: the chat surface manages bundles; individual Loader rows
  (`setPluginEnabled`) are only reachable from the Web plugin page.
- Plugin updates: an already-installed spec is refused by `inspect`, so an
  update is a removal plus an installation, or the host CLI.
- Archive set → close/reopen topics automatically (today `/close` and the
  topic-close service message do it; the reconciler does not poll the archive
  set).
- Re-bootstrap when the configured system topic disappears.
- `/cleanhistory`: deleting earlier bot messages is parked — the Bot API offers
  no message enumeration, and the 48-hour delete window makes any ring buffer
  fragile.
- Topic inventory is bounded by `seenThreads`; there is no way to reconcile
  topics the bot has never seen.
