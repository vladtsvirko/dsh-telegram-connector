# Compatibility

The connector is a Cordis plugin: it imports the harness's service types and
must run inside a matching DSH runtime. This page is the matrix we maintain with
every release.

| Connector | DSH | Status | Notes |
|---|---|---|---|
| 0.2.1-rc.2-0.1.11 | `0.2.1-rc.2` | tested | aligned release; the setup repo ships `v0.2.1-rc.2-0.1.11` |
| 0.2.1-rc.2-0.1.11 | `>=0.1.0-rc.6 <0.3.0-0` | declared peer range | outside the tested version, expect drift |

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
`0.2.1-rc.2-0.1.11`, and match the setup repo tag. The product part starts at
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
