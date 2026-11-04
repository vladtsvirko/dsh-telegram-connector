# Compatibility

The connector is a Cordis plugin: it imports the harness's service types and
must run inside a matching DSH runtime. This page is the matrix we maintain with
every release.

| Connector | DSH | Status | Notes |
|---|---|---|---|
| 0.2.1-rc.5-0.8.0 | `0.2.1-rc.5` | tested | maintenance: same connector code, aligned with the setup release that drops the Docker deployment mode and adds systemd resource limits |
| 0.2.1-rc.5-0.7.0 | `0.2.1-rc.5` | previous | inline buttons now require the admin account; `/commands --help`; aligned with the setup's multi-account git installer (connector code unchanged since 0.6.5) |
| 0.2.1-rc.5-0.6.4 | `0.2.1-rc.5` | tested | defensive instance-marker parsing; aligned with the setup marker fix |
| 0.2.1-rc.5-0.6.3 | `0.2.1-rc.5` | previous | maintenance: same connector code, aligned with the setup fixture fix |
| 0.2.1-rc.5-0.6.2 | `0.2.1-rc.5` | previous | maintenance: same connector code, aligned with the setup CI fix |
| 0.2.1-rc.5-0.6.1 | `0.2.1-rc.5` | previous | superseded: the setup tag had a red CI (fixture Docker + YAML dependency) |
| 0.2.1-rc.5-0.6.0 | `0.2.1-rc.5` | previous | held-session diagnosis (topic / client / second runtime), runtime registry repair at boot and in `/sync`, `/system status` registry + data-directory lines |
| 0.2.1-rc.5-0.5.1 | `0.2.1-rc.5` | previous | maintenance: same connector code, aligned with the setup release |
| 0.2.1-rc.5-0.5.0 | `0.2.1-rc.5` | previous | maintenance: same connector code, aligned with the installer release |
| 0.2.1-rc.5-0.4.0 | `0.2.1-rc.5` | previous | `/firewall` and `/firewall allow <port>`; the update report carries the advisory |
| 0.2.1-rc.5-0.3.0 | `0.2.1-rc.5` | previous | maintenance: same connector code, aligned with the setup release that warns about ufw on native hosts |
| 0.2.1-rc.5-0.2.2 | `0.2.1-rc.5` | previous | maintenance: same connector code, aligned with the setup fix |
| 0.2.1-rc.5-0.2.1 | `0.2.1-rc.5` | previous | maintenance: same connector code, aligned with the setup fix |
| 0.2.1-rc.5-0.2.0 | `0.2.1-rc.5` | previous | maintenance: same connector code, aligned with the installer release |
| 0.2.1-rc.5-0.1.2 | `0.2.1-rc.5` | previous | maintenance: same connector code, aligned with the setup release |
| 0.2.1-rc.5-0.1.1 | `0.2.1-rc.5` | previous | maintenance: same connector code, aligned with the installer fix |
| 0.2.1-rc.5-0.1.0 | `0.2.1-rc.5` | previous | maintenance: same connector code, aligned with the one-file install |
| 0.2.1-rc.5-0.0.0 | `0.2.1-rc.5` | previous | alignment release: same connector code as 0.8.0, rebuilt against rc.5 |
| 0.2.1-rc.2-0.8.0 | `0.2.1-rc.2` | previous | command menu, pinned control chat, admin-guarded binding, redacted errors, attachment notices |
| 0.2.1-rc.2-0.7.4 | `0.2.1-rc.2` | previous | maintenance: same connector code, aligned with the setup release |
| 0.2.1-rc.2-0.7.3 | `0.2.1-rc.2` | previous | maintenance: same connector code, aligned with the setup release |
| 0.2.1-rc.2-0.7.2 | `0.2.1-rc.2` | previous | maintenance: same connector code, aligned with the setup fix |
| 0.2.1-rc.2-0.7.1 | `0.2.1-rc.2` | previous | maintenance: same connector code as 0.7.0, aligned with the setup release |
| 0.2.1-rc.2-0.7.0 | `0.2.1-rc.2` | previous | one admin account, live status probes, bindings warning in chat |
| 0.2.1-rc.2-0.6.0 | `0.2.1-rc.2` | previous | the review release: mirror answers delivered, never-silent replies, idempotent group binding, `/web`, bot API timeouts, journaled mirrors, honest rollback/cancel, update-gate fix, `--uninstall` in the setup |
| 0.2.1-rc.2-0.4.11 | `0.2.1-rc.2` | previous | diagnostics for the mirror path (temporary); the setup repo ships `v0.2.1-rc.2-0.4.11` |
| 0.2.1-rc.2-0.4.10 | `0.2.1-rc.2` | previous | refused prompts are queued and delivered after a take-over restart |
| 0.2.1-rc.2-0.4.9 | `0.2.1-rc.2` | previous | one delivery path for Telegram turns and web mirrors |
| 0.2.1-rc.2-0.4.8 | `0.2.1-rc.2` | previous | a refused prompt no longer silences the topic mirror |
| 0.2.1-rc.2-0.4.7 | `0.2.1-rc.2` | previous | ownership refusals explained from create and resume |
| 0.2.1-rc.2-0.4.6 | `0.2.1-rc.2` | previous | web-UI takeover is mirrored again |
| 0.2.1-rc.2-0.4.5 | `0.2.1-rc.2` | previous | setup: shared design network, advisory probe |
| 0.2.1-rc.2-0.4.4 | `0.2.1-rc.2` | previous | a port change no longer starts a stopped component |
| 0.2.1-rc.2-0.4.3 | `0.2.1-rc.2` | previous | the setup installs dsh-penpot-plugin with the design component |
| 0.2.1-rc.2-0.4.2 | `0.2.1-rc.2` | previous | design stack uses the in-repo penpot CLI instead of an MCP bridge |
| 0.2.1-rc.2-0.4.1 | `0.2.1-rc.2` | previous | setup fix that built the design MCP bridge locally |
| 0.2.1-rc.2-0.4.0 | `0.2.1-rc.2` | previous | `/system manage` for optional components |
| 0.2.1-rc.2-0.3.1 | `0.2.1-rc.2` | previous | avoids blocking shutdown on a rate-limited main bot |
| 0.2.1-rc.2-0.3.0 | `0.2.1-rc.2` | previous | live process mode by default, leading-only slash, `/run` and `/skill`, media/staging fixes |
| 0.2.1-rc.2-0.2.1 | `0.2.1-rc.2` | previous | maintenance release; setup supervisor-test fix |
| 0.2.1-rc.2-0.2.0 | `0.2.1-rc.2` | previous | two-mode installer release (no connector change) |
| 0.2.1-rc.2-0.1.19 | `0.2.1-rc.2` | previous | process summaries/live cards + live host-command and skill bridge |

**Declared peer range** (not a release, and not tested): `>=0.1.0-rc.6 <0.3.0-0`.
It is what the package declares for the harness packages; a runtime inside it but
outside a tested row is expected to drift, and `/about` prints both values.

`/about` in the bot chat prints the connector version, the detected runtime
version and the declared peer range.

## How the range is expressed

The connector declares peer ranges against the harness packages
(`@deepseek-ai/dsh-agent`, `dsh-llm`, `dsh-session`), not against the `dsh` CLI
package. That is the contract the loader enforces. The tested version is the one
the release was exercised against; it is narrower than the peer range on
purpose.

## Version line

Connector versions are `<dsh-version>-<major>.<minor>.<patch>`, for example
`0.2.1-rc.5-0.6.4`, and match the setup repo tag. The product part starts at
`0.0.0` for each new DSH alignment; `0.x` is the compatible line and a new major
(`1.0.0`) marks an incompatible change. Same-major updates may jump between
releases; crossing a major or a DSH line needs the explicit
`--i-know-versions-are-incompatible` flag.

The tag, connector `package.json`, setup `VERSION`, image tags and Dockerfile
build args must agree. Tags are immutable. The full release checklist and the
coupling rules are in the setup repo's
[`docs/VERSIONS.md`](https://github.com/vladtsvirko/dsh-tg-docker-setup/blob/main/docs/VERSIONS.md).

## Release coupling

The two repositories ship as one tag even though only the connector contains
plugin code.

- The setup entrypoint forces
  `github:vladtsvirko/dsh-telegram-connector#v${DSH_SETUP_VERSION}` and installs
  that connector before the runtime starts.
- Therefore a setup release needs a connector tag with the same version, even
  when the setup change is the only code change.
- A connector change deployed through the image needs a setup release with the
  same version. A connector tag alone is not picked up by a reboot: the boot pin
  remains the setup tag.
- `/system update connector` reinstalls the **pinned** connector. It repairs that
  version; it does not select a newer connector tag.
- `/system update all` moves the setup tag and lets the new entrypoint install
  the matching connector.

There is no `DSH_VERSION` environment knob. The tested DSH version is hardcoded
in the setup release (`ARG DSH_VERSION` and the image tag), and the image
exports `DSH_RUNTIME_VERSION` for `/about`.

## Policy

- Every connector release states the DSH version it was tested with in this
  table; `/about` and the README follow the same value.
- A DSH upgrade that changes a service we use (agents, sessions, workspace
  registry/controller, session query/title, plugin manager) is a **compatibility
  event**: test the connector, then either widen the range or cut a connector
  release that matches.
- The plugin manager's own version exemptions (`compatibility.json`) are a
  separate mechanism for installed plugins; they do not change this matrix. The
  entrypoint grants one only when the runtime is outside the declared peer
  ranges, and treats that as an explicit risk.
- The Docker deployment's connector and DSH versions are the same release tag.
  That pair is what this matrix describes.

## Update paths

| Command/operation | What moves | Guard |
|---|---|---|
| `/system update connector` | reinstalls the connector pinned to the current setup | supervisor trial; profile only |
| `/system update all` | setup checkout, DSH image, connector pin, profile snapshot | drains agents; automatic rollback on failed health |
| `/system update all --i-know-versions-are-incompatible` | latest setup tag overall | explicit human flag; may cross DSH/product major |
| host `./update.sh --self` | same as update all, without draining | explicit host action |

`/system` never crosses a DSH line or product major without that flag. A
downgrade is not offered: a failed health gate restores the previous image
automatically, and a manual image rollback is a host operation.

## Reporting drift

If `/about` shows a runtime outside the tested row, send the output plus
`docker compose logs --tail=100 dsh`. Most incompatibilities surface as a missing
service (reported, never faked) or a changed result shape (rendered thinner, not
crashed). The deployment boundaries — including what cannot be fixed from
Telegram — are in the setup repo's
[`docs/LIMITS.md`](https://github.com/vladtsvirko/dsh-tg-docker-setup/blob/main/docs/LIMITS.md).
