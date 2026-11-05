/**
 * Plugin release discovery for `/system update`.
 *
 * The setup no longer derives plugin versions from its own tag. An update
 * therefore has to answer three questions on its own:
 *
 *   * which repository is this bundle from, and what tag is newest;
 *   * does that tag declare a DSH range the running runtime satisfies;
 *   * what spec would install it.
 *
 * GitHub is the only forge this project publishes to; a bundle installed from
 * an npm range or a local path is reported as host-managed instead of guessed
 * at. The module is deliberately pure apart from `fetch`, so the command's
 * decisions are testable without a runtime.
 *
 * @module dsh-telegram-connector/updates
 */

import { runtimeVersion } from './about.js'

export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  /** Dot-separated prerelease identifiers; empty for a stable version. */
  prerelease: string[]
}

export interface GitHubProject {
  owner: string
  repo: string
  /** The ref part of the source, when it had one. */
  ref?: string
}

export interface PluginRelease {
  /** `v`-prefixed tag, e.g. `v0.13.1`. */
  tag: string
  /** Bare version, e.g. `0.13.1`. */
  version: string
  /** The spec to install, in the same form as the existing source. */
  spec: string
  project: GitHubProject
  /** The declared peer range that was checked, when the manifest could be read. */
  range?: string
  /** False only when a declared range is known to exclude the runtime. */
  compatible: boolean
}

export interface ReleaseLookup {
  release?: PluginRelease
  /** A sentence for the user when no release can be chosen. */
  problem?: string
}

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/
const GITHUB = /^(?:github:|git\+)?(?:https?:\/\/github\.com\/)?([^/\s]+)\/([^/#\s]+?)(?:\.git)?(?:#(.+))?$/

export function parseVersion(text: string): ParsedVersion | undefined {
  const match = VERSION.exec(text.trim())
  if (match === null) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

/** Semver ordering: a stable version sorts after its own prereleases. */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (a === undefined && b === undefined) return 0
  if (a === undefined) return -1
  if (b === undefined) return 1
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const one = a.prerelease[index]
    const two = b.prerelease[index]
    if (one === undefined) return -1
    if (two === undefined) return 1
    if (one === two) continue
    const numericOne = /^\d+$/.test(one)
    const numericTwo = /^\d+$/.test(two)
    if (numericOne && numericTwo) return Number(one) < Number(two) ? -1 : 1
    if (numericOne) return -1
    if (numericTwo) return 1
    return one < two ? -1 : 1
  }
  return 0
}

/**
 * The comparator subset used by this project's peer ranges:
 * `>=0.1.0-rc.6 <0.3.0-0`. `^` and `~` are also accepted so a future range is
 * not silently treated as satisfied; `||` is not used and is rejected.
 */
export function satisfiesRange(version: string, range: string): boolean {
  if (range.trim().length === 0 || range.includes('||')) return false
  const parsed = parseVersion(version)
  if (parsed === undefined) return false
  for (const comparator of range.trim().split(/\s+/)) {
    const match = /^(>=|<=|>|<|=|\^|~)?(.+)$/.exec(comparator)
    if (match === null) return false
    const operator = match[1] ?? '='
    const bound = match[2] ?? ''
    const target = parseVersion(bound)
    if (target === undefined) return false
    const order = compareVersions(version, bound)
    if (operator === '>=' && order < 0) return false
    if (operator === '>' && order <= 0) return false
    if (operator === '<=' && order > 0) return false
    if (operator === '<' && order >= 0) return false
    if (operator === '=' && order !== 0) return false
    if (operator === '^') {
      if (target.major === 0) {
        if (parsed.major !== 0 || parsed.minor !== target.minor || order < 0) return false
      } else if (parsed.major !== target.major || order < 0) return false
    }
    if (operator === '~') {
      if (parsed.major !== target.major || parsed.minor !== target.minor || order < 0) return false
    }
  }
  return true
}

/**
 * Parse the arguments after `update <target>`:
 *
 *   now | to <version> | <version> | <name> | <name> to <version>
 *
 * Returns `undefined` for anything else so the caller can print usage instead
 * of guessing at a package or a tag.
 */
export function parseUpdateArgs(
  args: readonly string[],
  options: { name?: boolean } = {},
): { now: boolean; version?: string; name?: string } | undefined {
  const now = args.includes('now')
  const rest = args.filter((arg) => arg !== 'now')
  const looksVersion = (value: string): boolean => /^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(value)
  if (rest.length === 0) return { now }
  if (rest[0] === 'to') {
    if (rest.length !== 2 || rest[1] === undefined || !looksVersion(rest[1])) return undefined
    return { now, version: rest[1] }
  }
  if (rest.length === 1) {
    const value = rest[0] as string
    if (looksVersion(value)) return { now, version: value }
    if (options.name === true && value.length > 0) return { now, name: value }
    return undefined
  }
  if (options.name === true && rest.length === 3 && rest[1] === 'to' && rest[2] !== undefined && looksVersion(rest[2])) {
    return { now, name: rest[0], version: rest[2] }
  }
  return undefined
}

/** Recognize the git source forms the profile records for this project. */
export function parseGitHubSource(source: string): GitHubProject | undefined {
  const clean = source.trim()
  if (clean.length === 0 || clean.startsWith('link:') || clean.startsWith('file:')) return undefined
  // A registry range (`name ^1.2.3`, `name@1.2.3`) is not a repository.
  if (!clean.startsWith('github:') && !clean.startsWith('git+') && !clean.startsWith('https://github.com/')
    && !clean.startsWith('http://github.com/') && !/^[^/@\s]+\/[^/@\s]+(?:#.*)?$/.test(clean)) {
    return undefined
  }
  const match = GITHUB.exec(clean)
  if (match === null) return undefined
  return {
    owner: match[1] as string,
    repo: match[2] as string,
    ...(match[3] === undefined ? {} : { ref: match[3] }),
  }
}

/** Replace (or add) the ref on a git source, preserving its form. */
export function withRef(source: string, tag: string): string {
  const base = source.replace(/#.*$/, '')
  return `${base}#${tag}`
}

const headers = (): Record<string, string> => ({
  accept: 'application/vnd.github+json',
  'user-agent': 'dsh-telegram-connector',
  ...(process.env.GITHUB_TOKEN === undefined || process.env.GITHUB_TOKEN.length === 0
    ? {}
    : { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }),
})

/** Newest semver-looking tag; prereleases sort below their stable release. */
export async function latestTag(
  project: GitHubProject,
  fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
  const response = await fetchImpl(
    `https://api.github.com/repos/${project.owner}/${project.repo}/tags?per_page=100`,
    { headers: headers() },
  )
  if (!response.ok) {
    throw new Error(`GitHub answered ${String(response.status)} for ${project.owner}/${project.repo}`)
  }
  const body = await response.json() as Array<{ name?: unknown }>
  const tags = body
    .map((entry) => (typeof entry.name === 'string' ? entry.name : undefined))
    .filter((tag): tag is string => tag !== undefined && parseVersion(tag) !== undefined)
  tags.sort((left, right) => compareVersions(right, left))
  return tags[0]
}

interface ManifestShape {
  version?: unknown
  peerDependencies?: Record<string, unknown>
}

/** Read a tag's manifest so a known-incompatible update is refused before it runs. */
export async function declaredRange(
  project: GitHubProject,
  tag: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ range?: string; manifestVersion?: string; incompatible: boolean }> {
  const response = await fetchImpl(
    `https://raw.githubusercontent.com/${project.owner}/${project.repo}/${tag}/package.json`,
    { headers: { 'user-agent': 'dsh-telegram-connector' } },
  )
  if (!response.ok) return { incompatible: false }
  const manifest = await response.json() as ManifestShape
  const peers = manifest.peerDependencies ?? {}
  const runtime = runtimeVersion()
  let range: string | undefined
  let incompatible = false
  for (const [name, value] of Object.entries(peers)) {
    if (!name.startsWith('@deepseek-ai/dsh-') || typeof value !== 'string') continue
    range = value
    if (runtime !== undefined && !satisfiesRange(runtime, value)) incompatible = true
  }
  return {
    ...(range === undefined ? {} : { range }),
    ...(typeof manifest.version === 'string' ? { manifestVersion: manifest.version } : {}),
    incompatible,
  }
}

/**
 * Resolve the newest installable release for a git source.
 *
 * `explicit` is a user-supplied tag or version and skips discovery; the
 * compatibility check still applies.
 */
export async function resolveRelease(
  source: string,
  options: { explicit?: string; fetchImpl?: typeof fetch } = {},
): Promise<ReleaseLookup> {
  const project = parseGitHubSource(source)
  if (project === undefined) {
    return {
      problem: 'this bundle was not installed from GitHub, so there is no tag to resolve — update it from the host.',
    }
  }
  const fetchImpl = options.fetchImpl ?? fetch
  let tag: string | undefined
  if (options.explicit !== undefined && options.explicit.trim().length > 0) {
    const requested = options.explicit.trim()
    tag = requested.startsWith('v') ? requested : `v${requested}`
    if (parseVersion(tag) === undefined) return { problem: `\`${options.explicit}\` is not a version or tag.` }
  } else {
    try {
      tag = await latestTag(project, fetchImpl)
    } catch (error) {
      return { problem: `could not list releases: ${error instanceof Error ? error.message : String(error)}` }
    }
  }
  if (tag === undefined) return { problem: `no release tags found for ${project.owner}/${project.repo}.` }

  const version = tag.replace(/^v/, '')
  let declared: Awaited<ReturnType<typeof declaredRange>> = { incompatible: false }
  try {
    declared = await declaredRange(project, tag, fetchImpl)
  } catch {
    // A network failure here must not turn a reachable release into a refusal;
    // the install itself has its own compatibility gate and the trial rolls back.
  }
  if (declared.incompatible) {
    return {
      problem: `${project.repo} ${tag} declares \`${declared.range ?? 'a newer DSH range'}\`, which this runtime does not satisfy — update DSH first, or install that tag on the host with an explicit exemption.`,
    }
  }
  return {
    release: {
      tag,
      version,
      spec: withRef(source, tag),
      project,
      ...(declared.range === undefined ? {} : { range: declared.range }),
      compatible: true,
    },
  }
}
