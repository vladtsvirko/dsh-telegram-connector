# Commands

The bot has three surfaces. Each has its own command set, and each answers
`/help`, `/man` and `<command> --help` from the same registry the bot uses.

```
private chat with the bot        control plane   workspaces, plugins, restarts, updates
group "web-app"                  workspace
 ├── General / /setsystem topic  dashboard       sessions: /new, /sync, /close …
 └── session-…                   session topic   plain text is a turn, nothing else
```

Conventions:

- `<required>`, `[optional]`, `<a|b>` means choose one.
- Every command accepts `--help`; `/help <command>` and `/man [command]` show the
  same text.
- Aliases: `/start` = `/help`, `/plugin list` = `/plugins`, `/plugin install` =
  `/plugin add`, `/plugin rm` = `/plugin remove`.
- A `<session>` argument accepts the full session id, an id prefix, or the topic title.
- You can only use a command on the surface it belongs to; elsewhere the bot
  tells you where it lives.

---

## Bot chat (control plane)

### Workspaces

| Command | What it does |
|---|---|
| `/workspaces` | list workspaces, their group and their startgroup link |
| `/workspace new <title>` | create `<workspaceRoot>/<slug>`, register it in DSH, print the link |
| `/workspace link <name>` | print that link again |
| `/workspace rm <name>` | unregister from DSH, delete the binding, delete the group's session topics; files and sessions are untouched |

A workspace lives in exactly one group. Binding a different workspace to the same
group clears the group's session topics first. An **unbound** group accepts
`/bind <workspace id or title>` to attach itself; that command is only relevant
before the group is bound, so it is answered by routing rather than the dashboard.

### Plugins

| Command | What it does |
|---|---|
| `/plugins` | bundles of this profile: enabled, disabled, available |
| `/plugin info <name>` | version, source, rows, overrides, errors |
| `/plugin add <spec>` | inspect a package, then install it after confirmation |
| `/plugin remove <name>` | uninstall a bundle after confirmation |
| `/plugin enable <name>` | select a bundle after confirmation |
| `/plugin disable <name>` | deselect a bundle, keeping the package installed |
| `/plugin confirm` | run the pending action |
| `/plugin cancel` | drop the pending action |
| `/plugin approve` | allow the install scripts pnpm blocked, then retry |

A spec is a registry name (`pkg`, `pkg@1.2`), `github:owner/repo`, an absolute
path, or a tarball URL. `/plugin add` never mutates before `/plugin confirm`;
the pending action expires after ten minutes and is bound to its author.

Every confirmed plugin action opens a **trial** first: under HMR the change is
applied live with a rollback window, otherwise the runtime restarts into it.
Commit with `/system confirm`, revert with `/system rollback`, or let the window expire. A
failed install/removal closes the trial without touching the profile. The
connector refuses to disable or remove itself.

### System

| Command | What it does |
|---|---|
| `/system status` | connector and runtime versions, supervisor, open trial |
| `/system restart` | restart into a trial (default) |
| `/system restart now` | restart without a trial; the current state becomes the rollback point |
| `/system update connector` | reinstall the pinned connector, in a trial |
| `/system update connector now` | reinstall without a trial |
| `/system update all [--i-know-versions-are-incompatible]` | drain, then update setup through the updater sidecar; the flag permits a major/DSH jump |
| `/system confirm` | commit the open trial (also the **Commit** button) |
| `/system rollback` | restore the last committed state and restart (also **Roll back**) |
| `/status` | model route, workspace/session counts, poller, timezone, supervisor |
| `/about` | connector version, runtime version, supported DSH range |

`/system update connector` runs the entrypoint's `reset-plugin` with the runtime
stopped: the same allow-builds and version-compatibility logic that installed the
connector. A failed reinstall restores the previous state before the runtime comes
back. `now` skips the trial and makes the restarted state the rollback point.

`/system update all` blocks new prompts, waits until every agent (web UI and
Telegram) is idle, then asks the updater sidecar to apply the latest compatible
setup tag. If `DSH_UPDATER_TOKEN` is empty it falls back to printing the host
commands. The updater reports the result directly to the control chat; queued
messages from the downtime are answered once and never executed.

### Time

| Command | What it does |
|---|---|
| `/timezone` | show the zone used to read typed times |
| `/timezone <IANA>` | set it, e.g. `/timezone Europe/Minsk` |

Display is client-side: trial deadlines and reminders are Telegram `<tg-time>`
and render in **your** device's zone. Stored state and logs stay UTC. The stored
zone is what input will use (schedules), because “tomorrow at 9:00” needs exactly
one zone to become an instant.

### Placeholder

| Command | State |
|---|---|
| `/schedules` | not implemented yet |

---

## Workspace dashboard (General or the `/setsystem` topic)

| Command | What it does |
|---|---|
| `/new [title]` | mint a session and create its topic |
| `/sessions` | dashboard: path, workspace id, sessions |
| `/status [session]` | dashboard; with a session, that session's id, topic, model and agent state |
| `/setsystem` | make this empty topic the command surface |
| `/sync` | adopt sessions created in the web UI: topic + history replay; paced to Telegram limits |
| `/list archived` | archived sessions and whether they have a topic |
| `/unarchive <id\|all>` | restore archived sessions and create their topics |
| `/rename <session> <title>` | rename session and topic |
| `/model <session> <provider>/<model>` | per-session model route |
| `/close <session>` | archive the session and close its topic |
| `/reopen <session>` | unarchive and reopen |
| `/forget <session>` | drop the topic→session binding; both stay |
| `/unbind` | detach the group and delete its session topics |
| `/dangerous cleanup [confirm]` | delete known topics that are not sessions |

`/setsystem` only accepts a topic that holds no session, so a hand-made empty
topic can become the dashboard. General is the fallback.

`/sync` decides per session: archived → skip; bound → probe the topic and keep
the binding only if it answers; otherwise create a topic and replay the last 20
messages. Safe to repeat; the second run reports `adopted 0`.

It paces itself to Telegram's group limits (about one call per second, twenty
per minute) and retries a 429 after `retry_after`. When a wait is enforced it
posts once in the system chat:
`sync is rate-limited by telegram api, waiting for rate-limit to proceed, please wait`.

`/dangerous cleanup` lists what it would delete; nothing is deleted without
`/dangerous cleanup confirm`. Telegram cannot list topics, so only topics this
group has shown the bot are considered.

---

## Session topic

Plain text is a turn in that session. Management stays in the dashboard — one
topic is always one session, and a topic is never re-assigned. `/help` and
`/man` work here, everything else is answered with a pointer to the dashboard.

A topic created by hand becomes a session on its first message.

---

## Typical flows

```
# first workspace
/workspace new web-app                    (bot chat; tap the link, pick a group)
/new first session                        (General)
# a second session, named from Telegram
/new fix the checkout form                (General)
# adopt what the web UI already has
/sync                                     (General)
# install a plugin safely
/plugin add github:owner/repo             (bot chat)
/plugin confirm                           → trial or live window
/system confirm                          (or the Commit button)
# ship a new connector
/system update connector                   → reinstall → trial → /system confirm
```

See [DESIGN.md](DESIGN.md) for the mapping rules and the supervisor, and
[../COMPATIBILITY.md](../COMPATIBILITY.md) for which DSH versions this connector
supports.
