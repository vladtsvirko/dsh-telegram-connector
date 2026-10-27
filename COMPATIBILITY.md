# Compatibility

The connector is a Cordis plugin: it imports the harness's service types and
must run inside a matching DSH runtime. This page is the matrix we maintain with
every release.

| Connector | DSH | Status | Notes |
|---|---|---|---|
| 0.1.0-rc.1 | `0.2.1-rc.2` | tested | the release this repository describes; used by the Docker image |
| 0.1.0-rc.1 | `>=0.1.0-rc.6 <0.3.0-0` | declared peer range | outside the tested version, expect drift |

`/about` in the bot chat prints the connector version, the detected runtime
version and the declared peer range.

## How the range is expressed

The connector declares peer ranges against the harness packages
(`@deepseek-ai/dsh-agent`, `dsh-llm`, `dsh-session`), not against the `dsh` CLI
package. That is the contract the loader enforces. The tested version is the one
the release was exercised against; it is narrower than the peer range on
purpose.

## Policy

- Every connector release states the DSH version it was tested with in this
  table; the README badges and `/about` follow the same value.
- A DSH upgrade that changes a service we use (agents, sessions, workspace
  registry/controller, session query/title, plugin manager) is a **compatibility
  event**: test the connector, then either widen the range or cut a connector
  release that matches.
- The plugin manager's own version exemptions (`compatibility.json`) are a
  separate mechanism for installed plugins; they do not change this matrix.
- The Docker deployment pins `DSH_VERSION`; the connector installed into it comes
  from the ref in `DSH_TELEGRAM_PLUGIN`. Those two are what the matrix describes.

## Reporting drift

If `/about` shows a runtime outside the tested row, send the output plus
`docker compose logs --tail=100 dsh`. Most incompatibilities surface as a missing
service (reported, never faked) or a changed result shape (rendered thinner, not
crashed).
