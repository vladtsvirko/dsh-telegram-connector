#!/usr/bin/env node
/**
 * Tag contract: v<dsh-version>-<product-major>.<product-minor>.<product-patch>
 *   v0.2.1-rc.2-0.0.1
 * The product major is the compatibility line: same major updates may jump,
 * crossing it needs the explicit upgrade flag.
 */
import { readFile } from 'node:fs/promises'

const ref = process.env.GITHUB_REF_NAME ?? ''
if (!ref.startsWith('v')) {
  console.log('not a release tag; version check skipped')
  process.exit(0)
}

const fail = (message) => { console.error(`version check: ${message}`); process.exit(1) }
const tag = ref.slice(1)
const match = /^(.+)-(\d+)\.(\d+)\.(\d+)$/.exec(tag)
if (match === null) fail(`tag ${ref} is not v<dsh>-<major>.<minor>.<patch>`)
const [, dsh, major] = match
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z][0-9A-Za-z.-]*)?$/.test(dsh)) fail(`tag ${ref} has an invalid DSH part "${dsh}"`)
if (Number(major) > 0) console.log(`product major ${major}: breaking release, documented below`)

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
if (pkg.version !== tag) fail(`package.json is ${pkg.version}, tag is ${tag}`)

const compat = await readFile(new URL('../COMPATIBILITY.md', import.meta.url), 'utf8')
if (!compat.includes(`| ${tag} |`)) fail(`COMPATIBILITY.md has no row for ${tag}`)
if (!compat.includes(dsh)) fail(`COMPATIBILITY.md does not mention DSH ${dsh}`)

console.log(`version check ok: ${tag} (DSH ${dsh}, product ${match[2]}.${match[3]}.${match[4]})`)
