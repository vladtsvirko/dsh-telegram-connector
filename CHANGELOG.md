# Changelog

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
