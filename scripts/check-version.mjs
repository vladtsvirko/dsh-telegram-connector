#!/usr/bin/env node
/**
 * Tag contract: v<major>.<minor>.<patch>[-<prerelease>], matching package.json
 * and a row in COMPATIBILITY.md.
 *
 * The connector is versioned on its own since 0.13.0. The DSH it was tested
 * against is stated in COMPATIBILITY.md, not encoded in the tag, because a
 * setup release no longer has to move in lockstep with this repository.
 */
import { readFile } from 'node:fs/promises'

const ref = process.env.GITHUB_REF_NAME ?? ''
if (!ref.startsWith('v')) {
  console.log('not a release tag; version check skipped')
  process.exit(0)
}

const fail = (message) => { console.error(`version check: ${message}`); process.exit(1) }
const tag = ref.slice(1)
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(tag)) fail(`tag ${ref} is not v<major>.<minor>.<patch>`)

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
if (pkg.version !== tag) fail(`package.json is ${pkg.version}, tag is ${tag}`)

const compat = await readFile(new URL('../COMPATIBILITY.md', import.meta.url), 'utf8')
if (!compat.includes(`| ${tag} |`)) fail(`COMPATIBILITY.md has no row for ${tag}`)

console.log(`version check ok: ${tag}`)
