# Changelog

## 0.2.1-rc.5-0.10.0

Maintenance release; no connector code change. Aligned with the setup that
removes Docker: the agent gets rootless Podman, Penpot runs on rootful Podman.

## 0.2.1-rc.5-0.9.5

### Added

- **Telegram prompts carry their channel.** The prompt the agent receives starts
  with `[via Telegram]`, so it can answer with chat steps instead of host
  commands. Web UI prompts stay unmarked; the marker is part of the session
  transcript, not of the Telegram message.

## 0.2.1-rc.5-0.9.4

### Fixed

- **A prompt sent while the setup update restarted is no longer discarded.**
  The first Telegram batch after an update was refused wholesale with "send it
  again". Plain prompts and attachments are now delivered (the session survived
  the restart); only commands are refused, because a queued `/system …` or trial
  confirmation refers to the state the update replaced.

## 0.2.1-rc.5-0.9.3

Maintenance release; no connector change. Aligned with the setup cleanup of
stale `/system update all` text and the penpot 0.1.2 pin.

## 0.2.1-rc.5-0.9.2

### Fixed

- **Dashboard Status and Sessions were the same message.** On the dashboard
  surface `/status` without a session fell through to the session list, so both
  buttons printed the workspace dashboard. `/status` now reports the workspace
  and runtime state (session count, model route, poller, timezone) and
  `/sessions` lists the sessions.

## 0.2.1-rc.5-0.9.1

### Changed

- **Commands renamed, no aliases:** `/system update setup` (was `update all`),
  `/system components` (was `manage`), `/dashboard` (was `/setsystem`),
  `/archived` (was `/list archived`). `/about` is removed; `/system status`
  prints the same state.
- **Dashboard card.** `/dashboard` posts inline buttons: in a group, New
  session, Sync, Status and Sessions; in the bot chat, Status, Web link, Update
  setup, Restart, Plugins and Components. Each button runs the typed command, so
  permissions are identical; the deployment buttons are admin-only.
- **`/unbind`, `/dashboard` and `/dangerous cleanup` require admin**, matching
  `/bind` and the rest of the deployment-wide commands.
- The "system topic" is called the dashboard throughout; help and docs use the
  new names.

## 0.2.1-rc.5-0.9.0

### Changed

- The bot's help and error text describes the systemd deployment: `update all`
  moves the setup checkout through the updater service (not an image through a
  sidecar), rollback does not move the checkout or the DSH install, and the
  firewall note no longer compares a published Docker port.
- A held session names the other process and says `sudo systemctl stop
  dsh.service`; the no-supervisor and updater-unreachable hints point at
  `journalctl -u dsh-updater.service` and `update.sh --tg-connector`.

## 0.2.1-rc.5-0.8.2

Maintenance release; no connector change. Aligned with the setup fix that makes
DSH_PUBLIC_URL an accepted installer answer.

## 0.2.1-rc.5-0.8.1

Maintenance release; no connector change. Aligned with the setup fix for the
native smoke workflow and the health probe's bind address.

## 0.2.1-rc.5-0.8.0

Maintenance release; no connector change. Aligned with the setup release that
removes the Docker deployment mode and adds a CPU/RAM share to the systemd unit.

## 0.2.1-rc.5-0.7.0

### Fixed

- **Inline buttons now require the admin account.** Trial Commit/Roll back,
  component Enable/Disable/Port, the update card's ✖ and Take over all change
  the deployment for every user, but the callback handler checked only the
  allowlist while the typed equivalents required `adminUserId`. Any allowlisted
  member could restart the runtime or commit a rollback window. The gate now
  matches `/system`: a non-admin press is answered with
  "only the admin can do that" and does nothing.
- **`/commands --help` shows its help again.** The `/commands` branch ran before
  the generic `--help` handler, so the flag was swallowed and the host catalog
  printed instead. The handler now runs first on every surface.

### Changed

- The accepted update card no longer says "cancelling is no longer possible": the
  card's button is gone, but `/system cancel` still stops the job, and the card
  now says so.
- `/workspaces` help says the startgroup link is printed only for a workspace
  that has no group yet.

## 0.2.1-rc.5-0.6.4

Aligned with the setup fix for `data/.runtime.json`, which the entrypoint wrote
without a pid (invalid JSON) after an editing slip.

### Fixed

- **A malformed instance marker degrades to "unknown", never to a crash or a
  phantom holder.** The pid is trusted only as a positive integer, so a marker
  from a broken build cannot make `/system status` claim another runtime holds
  the data directory, and cannot hide the real one. With the marker fixed, a
  held session again distinguishes "another client in this runtime" (take-over
  card) from "another process over this data directory" (stop it first).

## 0.2.1-rc.5-0.6.3

Maintenance release; no connector change. Aligned with the setup patch that
makes the doctor fixture read the real invoking uid (CI runners are uid 1001)
and adds a test that pins the ownership mismatch itself.

## 0.2.1-rc.5-0.6.2

Maintenance release; no connector change. Aligned with the setup patch that
removes the credential helper's YAML dependency (the setup CI has no global dsh)
and makes its new doctor test independent of the runner's Docker daemon.
Supersedes 0.2.1-rc.5-0.6.1, whose CI stayed red on the credential tests.

## 0.2.1-rc.5-0.6.1

Maintenance release; no connector change. Aligned with the setup tag whose new
doctor test assumed a host without Docker — the CI runner has one, so the setup
released a patch with the test made deterministic.

## 0.2.1-rc.5-0.6.0

Aligned with the setup release that adds `install.sh --doctor`, keeps the
deployed provider key on a repair run, and refuses to run two runtimes over one
data directory.

### Fixed

- **A held session now says who holds it.** The refusal named "a web UI tab" for
  every case, so a session the *bot itself* still held in another topic, or one
  held by a second runtime over the same data directory, was blamed on a tab the
  user did not have — and `/system restart now` could not fix either. The
  connector now distinguishes the three cases: another topic (send there, or
  `/forget` this binding), a live client in this runtime (a tab; restart
  clears it), and another dsh process (stop it first; `./install.sh --doctor`
  names it). The take-over card is only offered when a restart can deliver.
- **A refused prompt is not queued where it could never arrive.** When another
  topic owns the session, replaying the prompt after a restart would hand it to
  whichever topic resumed first. It is no longer journaled for that case.
- **A re-bound topic no longer keeps the previous session's handle.** `/sync`
  replacing a dead binding, or a session being forgotten and re-minted in the
  same topic, left a runtime that still owned the old session; the next prompt
  resumed it and failed with an ownership error that pointed at a phantom tab.

### Added

- **The runtime registry is repaired at boot.** The web UI lists the runtime's
  workspace registry, while Telegram lists the connector's bindings; after a
  crash or a storage reset those disagree, and the web UI shows no workspace
  even though Telegram reports it and its sessions. A bound workspace whose
  directory still exists is recreated, its sessions are re-attached, and the
  control chat gets one notice. `/sync` does the same repair on demand instead
  of answering "this composition exposes no workspace registry".
- **`/system status` shows both lists and who owns the data directory.**
  `registry: N workspace(s) in the runtime · M bound to Telegram` makes the
  disagreement visible before a prompt fails, and `data:` names a second live
  runtime over the same directory (the one case a restart cannot clear).

## 0.2.1-rc.5-0.5.1

Maintenance release; no connector change. Aligned with the setup tag whose CI is
green.

## 0.2.1-rc.5-0.5.0

Maintenance release; no connector change. Aligned with the setup release that
configures git and installs Docker when the design stack needs it.

## 0.2.1-rc.5-0.4.0

### Added

- **`/firewall` — see and fix the ufw hole from Telegram.** A native install's
  web UI is only as reachable as ufw allows, and the fix used to need SSH.
  `/firewall` lists the ports the deployment serves with their networks and
  marks each allowed or blocked; `/firewall allow <port>` (admin only) asks the
  updater to allow it. The updater accepts only a port the deployment already
  serves from its `.env` and runs the fixed `ufw allow from <network> to any
  port <port> proto tcp` — never a command from the chat.
- A finished setup update now appends the same advisory to its report, so the
  blocked state arrives without asking and without a `--status` command.
- Docker deployments get "nothing to do": a published port is DNATed before
  ufw's `INPUT` chain sees it, so a rule there changes nothing.
## 0.2.1-rc.5-0.3.0

Maintenance release; no connector change. Aligned with the setup release that
warns when ufw would block a native install's web UI.

## 0.2.1-rc.5-0.2.2

Maintenance release; no connector change. Aligned with the setup fix for the design
plugin on native hosts.

## 0.2.1-rc.5-0.2.1

Maintenance release; no connector change. Aligned with the setup fix for the
unattended install.

## 0.2.1-rc.5-0.2.0

Maintenance release; no connector change. Aligned with the setup release that asks
for publisher bot tokens and names the downloaded checkout.

## 0.2.1-rc.5-0.1.2

Maintenance release; no connector change. Aligned with the setup tag whose CI is
green.

## 0.2.1-rc.5-0.1.1

Maintenance release; no connector change. Aligned with the setup fix for the
root re-run of the one-file install.

## 0.2.1-rc.5-0.1.0

Maintenance release; no connector change. Aligned with the setup release that adds
the one-file (wget/curl) install.

## 0.2.1-rc.5-0.0.0

Alignment release against DSH `0.2.1-rc.5`. No connector code change; the product
line restarts at `0.0.0` for the new DSH part.

### Changed

- Rebuilt against `@deepseek-ai/dsh-agent`, `dsh-llm` and `dsh-session`
  `0.2.1-rc.5`. Their published `lib/` is byte-identical to rc.2, and
  `typecheck` plus 191 tests pass unchanged.
- Peer ranges left alone (`>=0.1.0-rc.6 <0.3.0-0`). rc.5 is inside them and the
  loader evaluates prereleases, so the runtime needs no exact-version exemption.
- One `COMPATIBILITY.md` row added; the previous one is now `previous`.

## 0.2.1-rc.2-0.8.0

### Added

- **The command menu.** Telegram's menu above the input box was empty; it is now
  published for the bot chat and for groups, from the same registry as `/help`,
  so it cannot drift from the manual. Two calls on boot, one per scope.
- **`/system takechat`**: make the current private chat the control chat.
  Notices, update reports and failure cards go there, and moving it is explicit.
- **`/bind` is documented** (`/help bind`) — it was a real command in no help.

### Fixed

- **The control chat no longer follows the last DM.** It is claimed by the first
  private chat and stays there; an allowed colleague writing to the bot could
  earlier redirect someone else's notices — and the content in them — by
  messaging once. Only the admin moves it, with `/system takechat`.
- **Attaching a group is administration.** `/bind` and `/workspace new|link|rm`
  now need the admin: they decide what every user in a group can reach. The
  first-run `?startgroup=` link still works before the bot chat is claimed, so a
  fresh install cannot lock itself out.
- **A host command of the same name works in a session topic.** `/bind`,
  `/cleanup` and `/archived` exist on both sides; the connector's reservation
  used to refuse them outright instead of letting the host command run.
- **`agent/error` is redacted** before it reaches a group: a provider error can
  quote the key it rejected.
- **A failed attachment is reported to the user**, not only to the agent in the
  prompt.
- **`/plugin del` works** — it resolved in help but had no dispatcher.
- **`/unarchive` points at a command that works**: it said `/rename` "inside it",
  where `/rename` is refused; it now gives the full form to run from the dashboard.
- **A hard cut never splits a surrogate pair**, so an emoji at the 4,096 boundary
  stays one character.

### Notes

- With no `DSH_ADMIN_USER_ID` and no claimed bot chat, any allowed user may
  administer — otherwise a hand-written config could not bind its first group.
  `/about` says which rule is in effect.
## 0.2.1-rc.2-0.7.4

Maintenance release; no connector change. Aligned with the setup fix for the
native smoke workflow.

## 0.2.1-rc.2-0.7.3

Maintenance release; no connector change. Aligned with the setup fix for the
native smoke workflow.

## 0.2.1-rc.2-0.7.2

Maintenance release; no connector change. Aligned with the setup fix for the
native prepare working directory.

## 0.2.1-rc.2-0.7.1

Maintenance release; no connector change. It exists because the setup repo ships
one aligned tag and 0.7.1 fixes that repository's native smoke workflow.

## 0.2.1-rc.2-0.7.0

### Added

- **One admin account.** `DSH_ADMIN_USER_ID` (connector config `adminUserId`)
  names the account that may run `/system update|restart|rollback|confirm|cancel|manage`
  and `/plugin add|remove|enable|disable`. Everyone in `ALLOWED_USER_IDS` keeps
  full use of the agent and every session. Every allowed user could update or
  roll back the deployment for everyone before this.
- **`/status` answers the two questions it could not.** `web: 127.0.0.1:<port>
  answered 200|401|unreachable`, `key: set (OPENCODE_GO_API_KEY)|missing (…)`,
  and the last agent error with its time. `/about` and `/system status` name the
  admin and say how it was decided.
- **The bindings warning reaches the chat.** A `bindings.json` that cannot be
  read is kept aside and announced once, with the recovery step, instead of
  leaving every group answering "not attached" for no visible reason.

### Fixed

- **`/system` and `/plugin` are guarded on both entry paths**, including the
  inline-button callbacks.

### Notes

- No lockout on upgrade: with no `DSH_ADMIN_USER_ID`, the owner of the bot chat
  is the admin. New installs always set it (the installer defaults it to the
  first allowed id).
- Native mode now runs a real install → update → uninstall in CI
  (`.github/workflows/native-smoke.yml`, on every tag and weekly), and the image
  is built on every release tag.

## 0.2.1-rc.2-0.6.0

### Fixed

- **A hung Bot API call no longer freezes a topic.** No `fetch` carried a
  deadline, so one stalled connection left the topic's flush chain unsettled and
  that topic stopped updating until the process restarted. Every call now has a
  timeout: 60 s by default (`requestTimeoutSeconds`), the long poll extends
  Telegram's own hold time, and downloads get their own
  (`downloadTimeoutSeconds`, 120 s).
- **A mirrored turn survives a restart.** The answer lived only in the sink; a
  restart inside the flush window lost it and the catch-up digest never saw it.
  Mirrored turns are journaled and completed like Telegram turns.
- **`/system rollback` no longer promises what the supervisor refuses.** While
  another operation was running the supervisor answered `200` and did nothing,
  so the connector retired the card and the rollback became unreachable. The
  route now answers `409` (or `202` when it accepts), `/status` reports `busy`,
  and the connector checks before posting.
- **`/system cancel` stops the job, not just the card.** It asks the updater to
  cancel the running `update.sh` (the sidecar also stops a job that exceeds
  `DSH_UPDATE_TIMEOUT_SECONDS`, 30 minutes by default).
- **The update gate allows the recovery commands.** It matched on a prefix, so
  `/system update all` slipped through while `/system restart` was blocked — the
  reverse of what a stuck drain needs. The rule is now an explicit list with its
  own tests.

- **A mirrored web answer arrives as its own message.** Releasing a session to
  the web UI left the topic's sink in place, so the answer was appended to the
  previous Telegram turn and edited into that message — which sits above the
  echo, changes silently, and looks like no answer at all. A mirrored prompt now
  resets the sink, and the answer is gated behind the echo so it cannot overtake
  it. Covered by an integration test that drives the real plugin.
- **A reply is never dropped silently.** A refused chunk used to disappear: no
  log, no retry, no notice. It is logged with Telegram's code, retried once as
  plain text, and reported in the topic if that also fails.
- **A permission error no longer silences a group.** A 400 "not enough rights"
  was classified as "bot is not a member", which marked the bot missing and
  blocked the chat for an hour; the main bot was never re-checked. Only real
  membership failures do that now.
- **Re-tapping the startgroup link no longer wipes a group.** Binding was not
  idempotent: a second tap deleted every topic in the group, disposed live
  agents mid-answer and dropped every binding. Re-linking the same workspace now
  just prints the dashboard, a group that hosts another workspace is refused
  instead of seized, and moving a workspace clears the old group's bindings
  without deleting its history.
- **A prompt refused after a take-over is queued, not lost.** When the refusal
  arrived as an `agent/error` (the agent already existed), the prompt was never
  journaled, so the Take over button delivered nothing. It is journaled now and
  the card is posted with the button.
- **`/sync` keeps a healthy topic.** Any probe error (429, 5xx, network) counted
  as "topic deleted" and unbound the topic, leaked the agent and created a
  duplicate. Only a definite "message thread not found" purges a binding now,
  the runtime is disposed before the binding goes, and the summary counts the
  ones it could not probe.
- **`/unarchive <id>` reuses the session's topic** instead of binding one session
  to two topics (the mirror kept posting to the archived one).
- **A stuck `/system update all` drain can be cleared.** The update gate blocked
  every message including `/system restart`; `/system cancel` and the recovery
  commands now pass, and `/system cancel` is a text command, not just a button.
- **A corrupt or older `bindings.json` is kept, not overwritten.** It used to be
  replaced by an empty document and then overwritten on the next save — every
  binding gone, silently. It is now set aside as `bindings.json.corrupt-<ts>`
  with a log line.
- **Long formatted replies stay formatted.** A chunk that fits 3,800 markdown
  characters can exceed Telegram's 4,096 once converted to HTML (`/man` did), and
  the whole chunk fell back to plain text. Splitting now checks the converted
  length; `SAFE_LENGTH` is 3,400.

### Added

- **`/web`** prints a signed link into the web UI for the same sessions, with
  what handing a session over means. It is only available in the bot chat, so
  the link never lands in a group. `/about` and `/system status` now name the web
  root (without the token) and the declared peer range.
- `<command> --help` works in session topics too, as `/help` promised.

### Tests

- `tests/binding.integration.test.ts`: re-linking a group changes nothing, a
  group hosting another workspace is refused, moving a workspace clears the old
  bindings, `/unarchive` reuses its topic, `/sync` keeps a topic on a 5xx.
- The harness can refuse a Bot API call (`failSend`), and `waitFor` awaits async
  predicates.

## 0.2.1-rc.2-0.4.11

- Diagnostics for the mirror: the user echo reaches Telegram but the answer does
  not, and the decision points are silent. `mirror:` logs whether the topic was
  claimed, and `flush:` logs every flush that actually sends. Temporary; remove
  once the cause is known.

## 0.2.1-rc.2-0.4.10

- A refused Telegram prompt is no longer lost. It is journaled and the reply
  offers **Take over**: the supervisor restarts the runtime, every write handle is
  released, and the boot replay delivers the queued text without a retype.
- The journal replay drops prompts older than an hour, so a take-over that was
  never taken does not resurface days later.

## 0.2.1-rc.2-0.4.9

- One delivery path for a topic. A mirrored web turn now feeds the same sink as
  a Telegram turn — buffer, flush, edits, splitting, rich/HTML fallback — instead
  of a second plain-text pipeline through the outbox. Net -219 lines.
- What differs is declared on the sink, not duplicated in code: the mirror echoes
  the prompt (Telegram never saw it) and shows no process card (the web UI
  already does).
- A session taken over by another client drops its stale agent, so the next
  Telegram prompt resumes instead of reusing a handle that owns nothing.
- `MirrorQueue` and the mirror process-card machinery are gone.

## 0.2.1-rc.2-0.4.8

- A failed Telegram prompt no longer silences the topic. The attempt created a
  runtime entry before the runtime refused it, and "this topic has a runtime"
  was enough to drop every web turn mirror. A topic is now claimed only by a
  runtime that actually holds an agent and has not been taken over.
- The leftover entry from a failed attempt is dropped, so it cannot claim the
  topic later either.

## 0.2.1-rc.2-0.4.7

- A session held by another client now says so from both paths. The refusal came
  from `resume` (the session exists on disk), which was outside the friendly
  mapping, so the raw runtime error leaked to the chat.
- The advice is the one that works: the write handle is a kernel lock with no
  expiry, and a closed tab does not always release it, so `/system restart now`
  clears every handle. "Close the tab" was wrong when there was no tab.

## 0.2.1-rc.2-0.4.6

- A session taken over by a web UI tab is mirrored into its topic again. The
  connector used to keep streaming into an agent handle it no longer owned, so
  the topic went silent while Telegram prompts failed with the ownership error
  under a misleading "Process interrupted" card.
- The takeover is detected from a prompt the connector did not send, and the
  session is marked foreign until a Telegram prompt lands again.
- The refusal now says what happened ("this session is open in a web UI tab,
  so prompts from Telegram are refused until it closes") instead of looking
  like a crash.

## 0.2.1-rc.2-0.4.5

Maintenance release for the setup fix that reaches Penpot over the shared
network and no longer fails a component change on an unreachable probe. No
connector behavior change.

## 0.2.1-rc.2-0.4.4

Maintenance release for the setup fix that stops a port change from starting a
stopped component. No connector behavior change.

## 0.2.1-rc.2-0.4.3

Maintenance release for the setup change that installs the Penpot plugin when
the design component is enabled. No connector behavior change.

## 0.2.1-rc.2-0.4.2

Maintenance release for the setup change that replaces the design MCP bridge
with the in-repo `penpot` CLI. No connector behavior change.

## 0.2.1-rc.2-0.4.1

Maintenance release for the setup's local-build fix of the design stack. No
connector behavior change.

## 0.2.1-rc.2-0.4.0

- `/system manage` lists the optional components the setup registers and posts a
  card with Enable / Disable and Port buttons. The text form
  `/system manage <component> <enable|disable|port> [<port>]` does the same
  without a tap. The updater applies the change, restarts the runtime and
  reports; the connector never touches Docker.

## 0.2.1-rc.2-0.3.1

- Process cards no longer wait for a rate-limited main bot. A summary falls back
  to the outbox, live-card creation is skipped instead of blocking the turn, and
  a stale card is left for the next start rather than delaying shutdown or
  startup for the 429 block to expire.

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
