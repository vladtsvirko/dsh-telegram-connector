# Changelog

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
