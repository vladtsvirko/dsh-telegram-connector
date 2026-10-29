# Release and version rules

Versions are aligned with DSH and carry our own product line:

```
<dsh-version>-<major>.<minor>.<patch>      v0.2.1-rc.2-0.1.6
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
  `--i-know-versions-are-incompatible` flag in the setup updater; `/system`
  never crosses on its own.

## Release checklist

1. Align the DSH part with the tested `DSH_VERSION`; reset product to `0.0.0`
   for a new DSH line. Bump the product for our changes.
2. Update `package.json`/`package-lock.json`, `COMPATIBILITY.md` (one row per
   release) and `CHANGELOG.md`.
3. Run `npm run typecheck && npm test && npm run build`.
4. Commit, tag `v<version>`, push the tag. CI runs
   `scripts/check-version.mjs` and fails if the tag, package and matrix drift.
5. Bump the setup repo's `VERSION` and `DSH_TELEGRAM_PLUGIN` pin to the same
   tag. The setup release and this connector release ship together.

Do not move or reuse a tag. Do not put a breaking change in the `0.x` line.
