# Changelog

## 0.2.1-rc.2-0.3.0

- `processMode: live` is the new default. One process card is created on the
  first tool/command/skill row, edited during the turn, and finalised as a
  collapsed `<details>` summary. `summary` still sends only the collapsed
  summary after the turn; `off` hides process rows. Web-UI sessions follow the
  same mode.
- Live process-card refs are persisted in bindings, closed with a warning after
  a restart or graceful stop, and expired after 30 minutes of inactivity.
- Slash commands are detected only at the first non-whitespace character;
  slashes later in a prompt are literal. `/commands@bot` is accepted and a
  command addressed to another known bot is ignored. `//text` is a leading-only
  escape.
- `/run <command> [args]` executes a host command even when a connector name
  wins; `/skill <name> [args]` loads a user-invocable skill even when a host
  command owns the name.
- Media sent with a skill is attached to that turn, including reply references.
  Media sent with a command is staged for the next prompt instead of being
  dropped; unknown slash commands stage it too. Albums are debounced as one
  gesture.
- Failed command output and thrown command errors are redacted before posting;
  successful command output is unchanged. Command output still stays out of the
  model history, and replying to the result pulls it back in.
- `/commands` and `/skills` documentation now covers the collision escapes,
  leading-only slash rule and media behaviour.

## 0.2.1-rc.2-0.2.1

Maintenance release: ships with the setup's supervisor-test fix. No connector
behavior change.

## 0.2.1-rc.2-0.2.0

Maintenance release aligned with the setup's two-mode installer. No connector
behavior change: the same code runs under the container and under the new native
systemd deployment.

## 0.2.1-rc.2-0.1.19

- Tool calls, host commands and skill loads become short safe process rows.
  Telegram sessions append one collapsed `<details>` summary per turn
  (`processMode: summary`); web-UI-driven sessions get a live process card.
  Raw tool output is never mirrored; command/path/query previews are redacted and
  truncated, and credentials are masked.
- Session topics now bridge host commands dynamically with
  `ctx.commands.list()` / `ctx.commands.execute()`; no allowlist means a command
  from a newly installed plugin works without a connector release. The command
  result is posted without creating a model message.
- `/commands` lists host commands, `/skills` lists user-invocable skills, and
  `/<name>` loads a skill through the `dsh-tool-skill` gesture. Both lists are
  read live from the session, so new skills also work without a connector
  release.
- Connector commands keep precedence over host commands on a name collision.

## 0.2.1-rc.2-0.1.18

- Fix the `telegram-rich-text` skill never loading: the registration omitted the
  `source` field that the skills registry requires, so loading it failed with
  `source must be a string`.
- Send a Markdown table as a fenced monospaced block, or as bullets when it is
  too wide, instead of leaving the GFM table to the client. Clients that do not
  render tables showed the raw pipe syntax; a code block and a list work
  everywhere.

## 0.2.1-rc.2-0.1.17

- Forwarded messages are now processed as their own context turn with a
  `Forwarded from …` block. Forwarded rich messages are read from
  `rich_message.blocks`; forwarded media is re-downloaded and attached.
- A reply to a forwarded message adds `(forwarded from …)` to the reference
  block, so the model can tell that the quoted message was not written by the
  current user.
- The poll filter now admits forwarded and rich messages that carry no `text`.

## 0.2.1-rc.2-0.1.16

- Reply references now read `rich_message.blocks` as well as `text`/`caption`/
  `quote`. A reply to a message the connector sent as a rich message (for
  example the anchor test message) used to look like a plain prompt because
  Telegram puts the content in `rich_message`, not `text`.
- The rich-block extractor flattens headings, paragraphs, tables and nested
  inline text, skips layout metadata, and still truncates the quote to ~800
  characters.

## 0.2.1-rc.2-0.1.15

- Replying to an earlier message now adds it to the prompt as quoted reference
  context. Same-chat replies use `reply_to_message`; cross-chat/topic replies use
  `external_reply`.
- Referenced media is re-downloaded on every use (no cache), attached as
  `ImageBlock`/`FileBlock`, and deduped against staged or newly sent media by
  `file_id`.
- Download failures are written into the prompt, including the likely fixes
  (re-upload, send as a file, grant the bot access to the source chat).
- A text reply is a normal acknowledgment turn; a media reply is an immediate
  prompt with the new media as the task and the referenced media as context.
- Commands never attach referenced media.

## 0.2.1-rc.2-0.1.14

- Photos, image documents, videos, video notes, audio, voice notes and
  animations are downloaded through the Bot API and attached with DSH's
  attachment service: images become `ImageBlock`s, everything else becomes a
  `FileBlock` with a read-only path the agent can inspect.
- Captionless media is staged instead of starting a turn per file. Staged items
  get the **🙉** reaction, and the next caption or text prompt downloads and
  attaches the whole batch. The reaction is removed when the batch is used or
  after 15 minutes.
- Albums are debounced by `media_group_id`, so a multi-photo upload is one
  prompt, not one prompt per photo.
- `/reactions staged <emoji>` and `stagedReaction` configure the marker; the
  default is 🙉.

## 0.2.1-rc.2-0.1.13

- Every Telegram session gets a `telegram-surface` system-prompt section that
  tells the model the user is reading in Telegram and that replies are sent as
  rich messages. It asks for headings, lists, narrow tables, fenced code,
  details, math and `<tg-time>`, and warns against MarkdownV2 escaping and
  wrapping the whole answer in a code fence.
- The full formatting cheat sheet ships as `skills/telegram-rich-text/SKILL.md`
  and is registered as the `telegram-rich-text` runtime skill, so it is loadable
  on demand instead of inflating every prompt.
- The prompt section is installed on both newly created and resumed Telegram
  agents, including sessions adopted from the web UI.

## 0.2.1-rc.2-0.1.12

- Agent replies are sent as Telegram rich messages (Bot API 10.1+), so Markdown
  tables, headings and lists render natively instead of arriving as raw source.
  A rich message rejected by the API falls back to the HTML subset (a table
  becomes a monospaced block or a key/value list) and finally to plain text.
- Message splitting is table-aware: a table split across messages repeats its
  header and separator, so every chunk still renders as a table.
- The main bot sets a **read** reaction on an authorized prompt and a
  **streaming** reaction on each reply part that may still be edited; the
  streaming reaction is removed after the final flush, on agent error, and on
  shutdown. Both emoji are configurable online with `/reactions` and persisted
  in the bindings. Telegram's fixed reaction set is validated (`✓`, `✅` and
  `⏳` are not allowed; defaults are 👀 and ✍).
- A rejected HTML payload now falls back to rendered plain text instead of
  resending the Markdown source.

## 0.2.1-rc.2-0.1.11

- A failed topic operation no longer latches topic management off for the rest
  of the process. A transient 400/403 used to block `/new`, `/sync` and
  `/unarchive` even after the permission or topic was fixed.
- `/new` now reports Telegram's actual error instead of only guessing that
  `can_manage_topics` is missing.

## 0.2.1-rc.2-0.1.10

Maintenance release aligned with the setup fix for the web UI bind address. No
connector behavior change.

## 0.2.1-rc.2-0.1.9

- Mirror web-UI prompts and answers in log order; the answer used to read the
  event envelope instead of `event.data.message` and was never posted.
- Do not mirror harness-injected `user/message` context (time readings, runtime
  context, skill catalogs) as if the user had typed it.
- Match the claimed topic by group and thread, not thread id alone.

## 0.2.1-rc.2-0.1.8

Maintenance target for the web-UI drain/cancel test. No behavior change.

## 0.2.1-rc.2-0.1.7

- Boot fallback waits for a terminal update state instead of reading `applying`.
- Updater marks `reporting`/`reported`; the connector reports only if the updater
  could not, and closes the update card with the final result.

## 0.2.1-rc.2-0.1.6

- Fix the updater’s Telegram report (`fetch` option shadowed global `fetch`).
- If the updater cannot report, the booting connector sends the persisted result after 5s.
- Updater result files are written atomically.
- `/about` continues to show updater status.

## 0.2.1-rc.2-0.1.5

- `/about` reports updater status (`ready`, `unreachable`, `disabled`, or `apply unavailable`) and the checkout tag.

## 0.2.1-rc.2-0.1.4

Maintenance release for the self-reloading updater. No connector behavior change.

## 0.2.1-rc.2-0.1.3

- Editable setup-update card: target, live drain blockers, and a Cancel button.
- Cancel is removed once the updater accepts; callbacks after that are refused.
- `/about`, `/help`, `/man` and `/system status` stay available while draining.
- Updater sends a “dsh is down” notice and strips ANSI from report logs.
- `/about` no longer prints the old peer-range line.

## 0.2.1-rc.2-0.1.2

Maintenance target for the next setup-updater validation. No connector behavior
change.

## 0.2.1-rc.2-0.1.1

Maintenance release used as the first live target for the setup updater. No
connector behavior change.

## 0.2.1-rc.2-0.1.0

First DSH-aligned release with the updater sidecar. The DSH part matches the
tested runtime; the product part (`0.1.0`) is our compatible feature line.
Same-major updates may jump; crossing a major or DSH line requires the explicit
flag in the setup updater.

- Telegram sessions mount a DSH **agent preset** (default or `agentPreset`) on
  create and the header's recorded preset on resume.
- `/system` namespace: `status`, `restart [now]`, `update connector [now]`,
  `update all`, `confirm`, `rollback`; old commands removed.
- `/system update connector now` reinstalls without a trial.
- `/system update all` drains all agents (web UI included), blocks new prompts,
  calls the updater sidecar, and rejects the queued downtime batch with
  “update finished — send it again”.
- `/system status` lists sessions blocking a drain.

## 0.1.0-rc.1

First release candidate for 0.1.0.

First public shape of the connector.

- Groups map to workspaces, forum topics to sessions, the private chat to the
  control plane.
- Streaming replies, Markdown subset → Telegram HTML, fence-aware splitting.
- `/sync` adoption with per-session probing and history replay, paced to
  Telegram's per-chat limits and announced in the system chat while waiting.
- Durable bindings; sessions are resumed, never re-minted on restart.
- Plugin surface: list, info, add/remove with inspect + confirmation,
  enable/disable, build-script approval.
- Supervised restarts: `/restart` (trial), `/restart now`, `/confirm`,
  `/rollback`, live trials for HMR changes, automatic rollback on crash, boot
  failure, deadline or container restart.
- Self-update through the supervisor (`/update`).
- `/help`, `/man`, `<command> --help`, `/about`, `/timezone`.
- Per-group outbox: persisted FIFO with control priority, exactly-once delivery
  (ambiguous outcomes are quarantined, never duplicated), queue status line, a
  weekly saturation digest, and an owner notice when a message is lost so it is
  never silent.
- Logical bridge: durable out/in journals for turns and prompts, with a
  crash catch-up digest and prompt re-injection; the format is the boundary for
  a future standalone bridge process.
- Optional publisher bots (`DSH_TELEGRAM_PUBLISHER_TOKENS`): send-only, per-bot
  rate limits, proactive switching, membership checks and missing-member reports.
