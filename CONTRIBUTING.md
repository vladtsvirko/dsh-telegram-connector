# Contributing

Issues and pull requests are welcome. This is a small plugin; the fastest way to
get a change merged is to keep it focused and to show the failure it fixes.

## Setup

Requires Node 22+.

```sh
npm install
npm run typecheck
npm test
```

`npm run build` emits `lib/` (gitignored; the published package ships it).

## Layout

| File | Responsibility |
|---|---|
| `src/index.ts` | plugin entry: routing, commands, streaming, reconciliation |
| `src/help.ts` | the command registry, `/help`, `/man`, the Telegram command menu |
| `src/telegram.ts` | typed Bot API client |
| `src/render.ts` | rich-Markdown normalisation, Telegram HTML fallback, splitting |
| `src/outbox.ts` | per-group queue, pacing, exactly-once delivery, publishers |
| `src/bindings.ts` | durable v2 bindings file |
| `src/sessions.ts` | topic key model and workspace directories |
| `src/mirror.ts` | web-UI turn → topic mirroring |
| `src/reference.ts` | reply-to, forwards and attachment references |
| `src/media.ts` | media download, albums, staging |
| `src/slash.ts` | command parsing and `@bot` addressing |
| `src/plugins.ts` | `pluginManager` types and the plugin surface's rendering |
| `src/supervisor.ts` | client for the container supervisor's restart/rollback socket |
| `src/bridge.ts` | the turn journal (crash catch-up, queued prompts) |
| `src/bots.ts`, `src/rate-limit.ts`, `src/reactions.ts` | bot pool, token buckets, reactions |
| `src/errors.ts`, `src/about.ts`, `src/time.ts`, `src/process.ts` | redacted errors, version report, time zones, process rows |

## Testing against a real bot

Create a disposable bot and a disposable group with Topics enabled, add the
plugin to a profile that is not your main one, and point `$DSH_HOME` at a
throwaway directory so its `bindings.json` is separate:

```sh
DSH_TELEGRAM_BOT_TOKEN=… DSH_HOME=/tmp/dsh-connector-test dsh web
```

Useful checks: a topic created by hand, `/new` from the dashboard, `/sync` twice
in a row (the second must report `adopted 0`), rename in the web UI and in
Telegram, close/reopen a topic, and a restart in the middle of a session.

## Conventions

- TypeScript, strict, no `any` where a narrow type works.
- Comments explain *why* (a Telegram constraint, a DSH behaviour), not *what*.
- One behaviour per commit; the message says what changed and why.
- Keep the mapping invariants in `docs/DESIGN.md` true; update the doc with the
  code when a rule changes.

## Reporting a vulnerability

See [SECURITY.md](SECURITY.md) — please do not use the public issue tracker.
