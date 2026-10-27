# Security policy

## Reporting

Open a private security advisory on GitHub, or email the maintainer at the
address in `package.json`. Please do not file a public issue for a working
exploit. Expect an answer within a few days.

## Threat model

The connector gives a Telegram bot the ability to drive a DSH runtime: it can
start sessions, run tools with the runtime's permission mode, and delete forum
topics. Treat it with the same care as giving someone a shell in your workspace.

What protects it:

- **Allowlist.** `allowedUserIds` is checked on every update. Empty means nobody
  is allowed, not everybody.
- **Token handling.** The bot token is read from the environment or plugin
  config; it is never committed and never echoed back.
- **Admin actions need intent.** `/workspace rm` and `/unbind` delete the
  group's session topics (and say so); `/dangerous cleanup` additionally
  requires `/dangerous cleanup confirm`.
- **No secret storage.** `bindings.json` holds chat ids, workspace paths and
  session ids — not prompts, replies or credentials.

What it does not protect:

- A compromised bot token lets an attacker poll as the bot until the token is
  revoked with BotFather (`/revoke`).
- Anyone who is an admin of the group can close topics (which archives
  sessions) and rename the group (which renames the workspace).
- The runtime's own permission mode still governs what agents may do; the
  connector does not add a second sandbox.
- Telegram itself sees all message content.

## Hardening checklist

- Keep the group private and the bot non-admin where possible; it only needs
  *Manage Topics* and *Change Info*.
- List only your own Telegram user ids in `allowedUserIds`.
- Restrict `DSH_PERMISSION_MODE` in the runtime if the bot reaches a host you
  care about.
- Revoke and replace the token if it ever appears in logs or a repository.

## Supported versions

The `main` branch is the only supported line while the project is pre-1.0.
