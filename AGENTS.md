# Release and version rules

This repository is a DSH plugin, versioned on its own — it is **not** released
together with `dsh-tg-docker-setup`.

- Semver: `0.x` is the compatible line; a breaking change is `1.0.0`.
- Tags are `v` + `package.json` version, and immutable once pushed.
- The DSH release actually tested is a row in `COMPATIBILITY.md`. It is not
  encoded in the version and it does not belong in the tag.
- `peerDependencies` declares the supported DSH range. `/system update
  connector` reads the range from the tagged `package.json` and refuses a tag
  the running runtime does not satisfy; keep the range honest.
- Every tag is a candidate for the bot's update command. Do not push a tag you
  would not install.
- The setup pins a recommended tag and a minimum in its `plugins.json`; that is
  a fresh-install floor, not a ceiling. A newer compatible tag installed from
  the bot stays installed across reboots. Bumping the setup pin is a setup
  change, not a connector release.

## Repository metadata

The upstream DSH README asks plugin repositories to carry the GitHub topic
`dsh-plugin` (the About box, not a file). Keep it set, along with
`deepseek-harness` and the product topic (`telegram` or `penpot`). Topics need
repository administration rights; `gh repo edit --add-topic dsh-plugin` or the
API's `PUT /repos/{owner}/{repo}/topics` are the two ways to set them.

## Release checklist

1. Update `package.json`/`package-lock.json`, `COMPATIBILITY.md` (one row per
   release, with the tested DSH version), `CHANGELOG.md` and the manual-install
   pin in `README.md`.
2. If the DSH peer range changed, update `peerDependencies` and say why in
   `COMPATIBILITY.md`.
3. Run `npm run typecheck && npm test && npm run build`.
4. Commit, tag `v<version>`, push the tag. CI runs
   `scripts/check-version.mjs` and fails if the tag, package and matrix drift.
5. Optionally bump the setup's `plugins.json` recommendation and `minimum`.
   The setup does not need a matching tag, and this release does not need a
   setup release.

Do not move or reuse a tag. Do not put a breaking change in the `0.x` line.
