# Commands

The bot has three surfaces. Each has its own command set, and each answers
`/help` and `<command> --help` from the same registry the bot uses.

```
private chat with the bot        control plane   workspaces, plugins, restarts, updates
group "web-app"                  workspace
 ├── General / /dashboard topic  dashboard       sessions: /new, /sync, /close …
 └── session-…                   session topic   plain text is a turn, nothing else
```

Conventions:

- `<required>`, `[optional]`, `<a|b>` means choose one.
- Every command accepts `--help`; `/help <command>` shows the same text. The one
  exception is `/commands`, which lists the live host catalog instead of its own
  help.
- `/start` and `/menu` post the control center widget in the bot chat. In a group,
  `/start` is the `startgroup` deep link that binds the workspace.
- Admin-only (the `adminUserId` account, or the control-chat owner when unset):
  `/workspace new|link|remove`, every `/system` subcommand except `status`,
  `/components`, `/plugins add|remove|enable|disable|confirm|cancel|approve`,
  `/bind`, `/system takechat`, `/firewall allow`, `/unbind`, `/dashboard`,
  `/dangerous cleanup`. The inline buttons that do the same things — trial
  Commit/Roll back, the component card, the update card's **Cancel**, Take over,
  the deployment actions in the control center — are admin-only too.
- A `<session>` argument accepts the full session id, an id prefix, or the topic title.
- You can only use a command on the surface it belongs to; elsewhere the bot
  tells you where it lives.

---

## Bot chat (control plane)

### Workspaces

| Command | What it does |
|---|---|
| `/workspaces` | list workspaces, their group, and the startgroup link (only for a workspace that has no group yet) |
| `/workspace new <title>` | create `<workspaceRoot>/<slug>`, register it in DSH, print the link |
| `/workspace link <name>` | print that link again |
| `/workspace remove <name>` | unregister from DSH, delete the binding, delete the group's session topics after a confirmation card; files and sessions are untouched |

A workspace lives in exactly one group. A group that is already bound **cannot**
be rebound: binding a different workspace there is refused, and you must
`/unbind` first (which deletes the group's session topics). An **unbound** group
accepts `/bind <workspace id or title>` to attach itself; that command is only
relevant before the group is bound, so it is answered by routing rather than the
dashboard.

### Plugins

| Command | What it does |
|---|---|
| `/plugins` | bundles of this profile: enabled, disabled, available |
| `/plugins info <name>` | version, source, rows, overrides, errors |
| `/plugins add <spec>` | inspect a package, then install it after confirmation |
| `/plugins remove <name>` | uninstall a bundle after confirmation |
| `/plugins enable <name>` | select a bundle after confirmation |
| `/plugins disable <name>` | deselect a bundle, keeping the package installed |
| `/plugins confirm` | run the pending action |
| `/plugins cancel` | drop the pending action |
| `/plugins approve` | allow the install scripts pnpm blocked, then retry |

A spec is a registry name (`pkg`, `pkg@1.2`), `github:owner/repo`, an absolute
path, or a tarball URL. `/plugins add` never mutates before you press **Confirm** (or send `/plugins confirm`);
the pending action expires after ten minutes and is bound to its author.

Every confirmed plugin action opens a **trial** first: under HMR the change is
applied live with a rollback window, otherwise the runtime restarts into it.
Commit with `/system confirm`, revert with `/system rollback`, or let the window expire. A
failed install/removal closes the trial without touching the profile. The
connector refuses to disable or remove itself.

### Menu

| Command | What it does |
|---|---|
| `/menu` · `/start` | post the control center widget: Status, Spaces and System in one card |
| `/start` | the control center in the bot chat; the `startgroup` deep link in a group |
| `/panel` | post the control center widget: live status, workspace links, component switches and system actions |

### System

| Command | What it does |
|---|---|
| `/system status` | connector and runtime versions, supervisor, open trial |
| `/system restart` | restart into a trial (default) |
| `/system restart now` | restart without a trial; the current state becomes the rollback point |
| `/system update connector [to <version>] [now]` | move the connector to its newest compatible version, in a trial |
| `/system update penpot [to <version>] [now]` | move the Penpot plugin to its newest compatible version through the plugin manager |
| `/system update plugin <name> [to <version>] [now]` | the generic form for any GitHub-installed bundle |
| `/system update setup [--i-know-versions-are-incompatible]` | show a card with the target, DSH change, recent commit subjects and running sessions, then drain and update through the updater service; a cross-line jump gets a second **Cross anyway** confirmation |
| `/system confirm` | commit the open trial (also the **Commit** button) |
| `/system rollback` | restore the last committed state and restart (also **Roll back**) |
| `/components [<component> <enable\|disable\|port> [<port>]]` | optional components: a card with Enable/Disable/Port buttons, or the text form. The Port button offers three presets (8090/8091/8092); use the text form for anything else |
| `/system cancel` | abandon a pending update and unblock the bot (same as the card's **Cancel**); after acceptance it stops the running updater job |
| `/system takechat` | make this private chat the control chat; notices, update reports and failure cards move here |
| `/firewall` | whether ufw lets the web UI through, and the exact `/firewall allow <port>` to fix it |
| `/firewall allow <port>` | admin only; asks the updater to allow that served port from the LAN |
| `/web` | a signed link into the web UI for the same sessions (bot chat only) |
| `/reactions` | show the read, streaming and staged-media reactions |
| `/reactions read <emoji>` | set the prompt reaction; `off` disables it |
| `/reactions streaming <emoji>` | set the in-progress reply reaction; `off` disables it |
| `/reactions staged <emoji>` | set the staged-media reaction; `off` disables it |
| `/reactions on` / `/reactions off` | enable or disable all reactions |
| `/reactions reset` | drop the overrides and return to the plugin defaults |
| `/reactions allowed` | list the emoji Telegram accepts in a reaction |

The **read** reaction is set on your prompt as soon as the bot reads it. The
**streaming** reaction is set on a reply while the bot may still edit it and is
removed when the turn ends, the agent errors, or the connector stops. The
**staged** reaction marks a captionless photo/file/video/audio upload until the
caption or text prompt that consumes it arrives; it is removed when the media is
used or after 15 minutes. All values are saved in the bindings, so an online
change survives a restart. Telegram only accepts its own reaction emoji; `✓`,
`✅` and `⏳` are not in that set, which is why the defaults are 👀, ✍ and 🙉.

`/system update connector` resolves the newest npm version (or the repository
tag for a git install, or the exact `to <version>`), refuses a version whose declared DSH range excludes
this runtime, and runs the entrypoint's `reset-plugin` with the runtime stopped
and that ref in the environment: the same allow-builds and compatibility logic
that installed the connector. A failed install or an unhealthy boot restores the
previous state before the runtime comes back. `now` skips the trial and makes the
restarted state the rollback point.

`/system update penpot` (and `/system update plugin <name>`) resolves the
bundle's newest version and replaces the package through the host plugin manager,
inside a trial opened before the removal. If the new version fails to install,
the previous spec is reinstalled immediately; if that also fails, the supervisor
restores the pre-update profile. The bundle's configuration row is untouched.

`/system update setup` blocks new prompts, waits until every agent (web UI and
Telegram) is idle, then asks the updater sidecar to apply the latest compatible
setup tag and rebuild the image. The new entrypoint installs the connector tag
derived from that setup version. If `DSH_UPDATER_TOKEN` is empty it falls back to
printing the host commands. The updater reports the result directly to the
control chat; queued messages from the downtime are answered once and never
executed.

The commands cover different scopes: `update connector` and `update plugin`
change only the profile; `update setup` changes the setup checkout and DSH
install. Plugin versions are independent of the setup tag, so a setup update no
longer forces a connector or Penpot version.
`/system rollback` restores the profile, **not** the image or the setup tag. Once
the updater accepts an `update setup` job the card's ✖ button is removed, but the
job is still cancellable with `/system cancel` (the updater stops it with
`SIGTERM`, then `SIGKILL`) and it has a deadline of `DSH_UPDATE_TIMEOUT_SECONDS`
(default 30 minutes). The scopes and the
host-only recovery paths are in the setup repo's
[LIMITS.md](https://github.com/vladtsvirko/dsh-tg-docker-setup/blob/main/docs/LIMITS.md).

### Time

| Command | What it does |
|---|---|
| `/timezone` | show the zone used to read typed times |
| `/timezone <IANA>` | set it, e.g. `/timezone Europe/Minsk` |

Display is client-side: trial deadlines and reminders are Telegram `<tg-time>`
and render in **your** device's zone. Stored state and logs stay UTC. The stored
zone is what typed input will use, because “tomorrow at 9:00” needs exactly one
zone to become an instant.

---

## Buttons

Two kinds of inline keyboard exist. The **dashboard card** is a menu; every
button runs the same command you could type, so permissions are identical:

| Card | Buttons |
|---|---|
| group dashboard (`/dashboard`) | New session · Sync · Status · Sessions |
| bot chat (`/menu`) | Status · Workspaces · Web link · Help · Update setup · Restart · Plugins · Components |

The **flow cards** are confirmation prompts: trial Commit/Roll back, the update
card's **Cancel** (while draining), component Enable/Disable/Port, and Take over (confirmed; restarts dsh) for a
held session. They are admin-only, like their commands.

Every consequential action uses one **Confirm / Cancel** card: `/workspace
remove`, `/unbind`, `/dangerous cleanup`, plugin add/remove/enable/disable and
the dashboard **Restart** button. Each press answers with a toast
(`deleting…` / `cancelled`), and the card is edited to the result. The typed
fallback remains: `/workspace remove <name> confirm`, `/unbind confirm`,
`/dangerous cleanup confirm` and `/plugins confirm`.

## Icons and marks

Controls are words. No emoji appears on a button, menu entry, status line or
process row: Telegram renders emoji differently per client, screen readers
announce their names, and a label that needs an icon next to it is not yet a
label.

- Buttons: verb-first text only (`Update now`, `Commit`, `Delete 3 topics`).
- Status: the first word carries it (`committed`, `failed`, `queued`,
  `waiting`); a bare exception is prefixed `error:`.
- Structure: `·` for list items and `→` for transitions; both are typographic.
- Process rows: `Read: path`, `Search: query`, `Skill: name` — no tool glyphs.
- Tasks: `[x]` and `[ ]`.
- **Reactions are the exception.** Telegram only accepts emoji from its fixed
  set, so `/reactions` is the one place the bot uses them; the defaults are
  👀, ✍ and 🙉, and `/reactions allowed` lists the valid set.

## Workspace dashboard (General or the `/dashboard` topic)

| Command | What it does |
|---|---|
| `/new [title]` | mint a session and create its topic |
| `/sessions` | dashboard: path, workspace id, sessions |
| `/status [session]` | dashboard summary (sessions, model route, poller, timezone); with a session, that session's id, topic, model and agent state |
| `/dashboard` | claim this empty topic as the dashboard and post its button card |
| `/sync` | adopt sessions created in the web UI: topic + history replay; paced to Telegram limits |
| `/archived` | archived sessions and whether they have a topic |
| `/unarchive <id\|all>` | restore archived sessions and create their topics |
| `/rename <session> <title>` | rename session and topic |
| `/model <session> [<provider>/<model>]` | per-session model route; without a route it lists the models this runtime advertises |
| `/close <session>` | archive the session and close its topic |
| `/reopen <session>` | unarchive and reopen |
| `/forget <session>` | drop the topic→session binding; both stay |
| `/unbind` | detach the group and delete its session topics |
| `/dangerous cleanup [confirm]` | delete known topics that are not sessions |

`/dashboard` only accepts a topic that holds no session, so a hand-made empty
topic can become the dashboard. General is the fallback until then — and once
`/dashboard` moves the dashboard, **General becomes an ordinary session topic**:
the next plain message there starts a session. That is why the bot asks for an
empty topic rather than reusing General.

The Telegram command menu is registered per chat type, not per topic, so a
session topic still lists the dashboard commands in its `/` menu; the bot
answers them with a pointer to the dashboard instead of running them.

`/sync` decides per session: archived → skip; bound → probe the topic and keep
the binding only if it answers; otherwise create a topic and replay the last 20
messages. Safe to repeat; the second run reports `adopted 0`.

It paces itself to Telegram's group limits (about one call per second, twenty
per minute) and retries a 429 after `retry_after`. When a wait is enforced it
posts once in the dashboard chat:
the sync card says `waiting for Telegram's rate limit; it continues automatically`.

`/dangerous cleanup` lists what it would delete; nothing is deleted without
`/dangerous cleanup confirm`. Telegram cannot list topics, so only topics this
group has shown the bot are considered.

---

## Session topic

Plain text is a turn in that session. Management stays in the dashboard — one
topic is always one session, and a topic is never re-assigned.

| Command | What it does |
|---|---|
| `/commands` | list the host slash commands registered for this session, read live |
| `/skills` | list user-invocable skills from the workspace catalog, read live |
| `/<name>` | load a user-invocable skill into the next turn |
| `/run <command> [args]` | run a host command even when a connector command owns the name |
| `/skill <name> [args]` | load a skill even when a host command owns the name |
| `//text` | send a prompt that literally starts with `/` |
| `/help`, `/help` | the session command manual |

Host commands (for example `/compact`, `/goal` or a command from a newly
installed plugin) run against the session without creating a model message.
The lists are read live, so a plugin that registers a command or skill appears
without a connector release. Connector commands keep precedence; `/run` and
`/skill` are the escape hatches for name collisions.

Only the first non-whitespace `/` starts a command. Slashes later in the text
are literal and never need escaping. `/commands@bot` is accepted; a command
addressed to a different known bot is ignored.

Media sent with a skill is attached to that turn. Media sent with a command is
staged with the configured staged reaction for the next prompt, because commands
do not take attachments. An album is debounced and treated as one gesture.

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
/plugins add github:owner/repo             (bot chat)
/plugins confirm                           → trial or live window
/system confirm                          (or the Commit button)
# ship a new connector
/system update connector                   → newest compatible version → trial → /system confirm
```

See [DESIGN.md](DESIGN.md) for the mapping rules and the supervisor, and
[../COMPATIBILITY.md](../COMPATIBILITY.md) for which DSH versions this connector
supports.
