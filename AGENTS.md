# Release and version rules

Versions are aligned with DSH and carry our own product line:

```
<dsh-version>-<major>.<minor>.<patch>      v0.2.1-rc.2-0.1.17
```

- **DSH part** is exactly the DSH release this connector was tested against.
- **Product part** starts at `0.0.0` when aligning to a new DSH.
  - patch: fixes
  - minor: compatible features
  - **major: incompatible change**. Major 0 is the compatible line; `1.0.0`
    marks a break. Never ship a breaking change as `0.x`.
- Tags are `v` + the package version; tags are immutable once pushed.
- Same major: updates may jump (`0.0.1 → 0.4.2`).
- Different major or a different DSH part: crossing requires the explicit
  `--i-know-versions-are-incompatible` flag; `/system` never crosses on its own.
- The setup entrypoint installs the connector tag derived from the setup
  `VERSION`. A setup-only release therefore still needs a connector maintenance
  tag with the same version, and a deployed connector change needs a setup
  release. The two repositories ship together.

## Release checklist

1. Align the DSH part with the tested `DSH_VERSION`; reset product to `0.0.0`
   for a new DSH line. Bump the product for our changes.
2. Update `package.json`/`package-lock.json`, `COMPATIBILITY.md` (one row per
   release) and `CHANGELOG.md`.
3. Run `npm run typecheck && npm test && npm run build`.
4. Commit, tag `v<version>`, push the tag. CI runs
   `scripts/check-version.mjs` and fails if the tag, package and matrix drift.
5. Bump the setup repo's `VERSION`, every image tag, `Dockerfile`
   `DSH_SETUP_VERSION` and its AGENTS example to the same tag. The connector ref
   is derived from `VERSION`; there is no `.env` pin to edit. The setup release
   and this connector release ship together.

Do not move or reuse a tag. Do not put a breaking change in the `0.x` line.
