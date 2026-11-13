# Standalone use

`dsh-telegram-connector` is a normal DSH bundle. The systemd/Podman setup is a
packaging choice; it is not an import, a service or a file the connector reads.
The same package runs in any DSH profile.

## Requirements

| What | Why |
|---|---|
| DSH matching the range in [COMPATIBILITY.md](../COMPATIBILITY.md) | `agents`, `sessions`, the plugin manager (optional) |
| Node 22 and pnpm | `dsh plugin`; source installs also need the build script |
| A Telegram bot token | polling and the Bot API |
| A Telegram user id | the allowlist; an empty list refuses everyone |

## Install

```sh
# Published package: the tarball already contains lib/, so no build script.
dsh plugin --profile web add dsh-telegram-connector@0.16.0
```

From the source repository instead:

```sh
cat >> "$DSH_HOME/profiles/web/pnpm-workspace.yaml" <<'YAML'
allowBuilds:
  dsh-telegram-connector@https://github.com/vladtsvirko/dsh-telegram-connector.git: true
YAML
dsh plugin --profile web add github:vladtsvirko/dsh-telegram-connector#v0.16.0
```

Open **Plugins** → **dsh-telegram-connector** → **Configure** and fill in the
bot token, allowed user ids and optional admin id. **Save** stores them in the
profile's user layer; a saved token starts polling without a runtime restart,
and the ids are read on every check. No environment file is required.

The bundle patch still reads deployment values from the environment as the
fallback:

```sh
export DSH_TELEGRAM_BOT_TOKEN='123456:ABC…'
export ALLOWED_USER_IDS='142283532,987654321'   # comma or space separated
export DSH_ADMIN_USER_ID='142283532'            # optional; control-chat owner otherwise
dsh --profile web
```

`provider`/`model` default to `deepseek-official`/`deepseek-v4-flash` and can be
set with `DSH_PROVIDER`/`DSH_MODEL`. A profile override still works when the
values belong in `cordis.patch.yml` instead:

```yaml
- id: dsh-telegram-connector
  config:
    allowedUserIds: [142283532]
    adminUserId: 142283532
```

`adminUserId` is optional but recommended: without it the control-chat owner
becomes the admin. Every other user in `allowedUserIds` can talk to the agent;
only the admin can run `/system` mutations, `/plugin` mutations and
`/workspace`/`/bind`.

## What differs without the setup

The connector detects what the runtime exposes and says what it cannot do. No
feature silently disappears.

| Feature | Setup | Standalone |
|---|---|---|
| Sessions, topics, workspace dashboard, media, reactions | yes | yes |
| `/plugins`, `/plugins add|remove|enable|disable` | yes, DSH plugin manager | yes, if the profile is base-backed with `pluginManager`; otherwise the commands explain that it is absent |
| `/system update penpot`, `/system update plugin <name>` | yes, wrapped in a supervisor trial | yes through the plugin manager; without a supervisor there is no automatic rollback |
| `/system update connector` | yes: newest compatible npm version, installed by the supervisor | no: update from the host with the two `dsh plugin` commands below |
| `/system update setup`, `/components`, `/firewall` | yes, through the updater service | no: the updater is not present, and the commands say so |
| `/system restart`, `/system rollback` | supervisor trial | restart the runtime yourself; no trial |
| `/system status` | versions, supervisor, registry, data directory | the same lines, with absent components marked |

The connector never assumes `/srv/dsh`, systemd, Podman or the updater. It reads
`DSH_HOME`, `DSH_WORKSPACE`, `DSH_PORT` and the optional supervisor/updater
variables; all have defaults.

## Update and remove

```sh
dsh plugin --profile web remove dsh-telegram-connector
dsh plugin --profile web add dsh-telegram-connector@<new>
```

The plugin manager cannot install a git package over an installed one, so removal
comes first. Restart the runtime after the install; the connector is the process
serving the chat, so it cannot replace itself in place. In the setup, the
supervisor performs exactly this sequence while the runtime is stopped and wraps
it in a trial.

## Verify

Send `/status` to the bot: it reports the connector version, runtime version,
model route and poller state. `/system status` names the missing supervisor or
updater explicitly instead of failing a command.
