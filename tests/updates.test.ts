import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  latestTag,
  parseGitHubSource,
  parseUpdateArgs,
  parseVersion,
  resolveRelease,
  satisfiesRange,
  withRef,
} from '../src/updates.js'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** One fake transport for both api.github.com and raw.githubusercontent.com. */
const fakeFetch = (tags: string[], manifest: Record<string, unknown>): typeof fetch =>
  (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.includes('/tags?')) return json(tags.map((name) => ({ name })))
    if (url.includes('raw.githubusercontent.com')) return json(manifest)
    return json({ message: 'not found' }, 404)
  }) as typeof fetch

describe('versions', () => {
  it('parses stable and prerelease forms', () => {
    expect(parseVersion('v0.2.1-rc.5')).toMatchObject({ major: 0, minor: 2, patch: 1, prerelease: ['rc', '5'] })
    expect(parseVersion('0.13.0')).toMatchObject({ prerelease: [] })
    expect(parseVersion('main')).toBeUndefined()
  })

  it('sorts a stable release above its prereleases', () => {
    expect(compareVersions('0.13.0', '0.13.0-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('0.13.0', '0.12.9')).toBeGreaterThan(0)
    expect(compareVersions('0.2.1-rc.5', '0.2.1-rc.4')).toBeGreaterThan(0)
    expect(compareVersions('v0.13.0', '0.13.0')).toBe(0)
  })

  it('checks the comparator ranges this project declares', () => {
    expect(satisfiesRange('0.2.1-rc.5', '>=0.1.0-rc.6 <0.3.0-0')).toBe(true)
    expect(satisfiesRange('0.3.0', '>=0.1.0-rc.6 <0.3.0-0')).toBe(false)
    expect(satisfiesRange('0.2.1-rc.5', '^0.2.0')).toBe(true)
    expect(satisfiesRange('0.3.0', '^0.2.0')).toBe(false)
  })
})

describe('sources', () => {
  it('understands the git forms a profile records', () => {
    expect(parseGitHubSource('github:vladtsvirko/dsh-penpot-plugin#v0.3.0')).toEqual({
      owner: 'vladtsvirko',
      repo: 'dsh-penpot-plugin',
      ref: 'v0.3.0',
    })
    expect(parseGitHubSource('https://github.com/vladtsvirko/dsh-penpot-plugin.git')).toEqual({
      owner: 'vladtsvirko',
      repo: 'dsh-penpot-plugin',
    })
  })

  it('does not mistake a registry range or a link for a repository', () => {
    expect(parseGitHubSource('dsh-penpot-plugin ^0.3.0')).toBeUndefined()
    expect(parseGitHubSource('link:/srv/dsh/plugin')).toBeUndefined()
    expect(parseGitHubSource('file:../plugin')).toBeUndefined()
  })

  it('replaces the ref without changing the source form', () => {
    expect(withRef('github:o/r#v0.1.0', 'v0.2.0')).toBe('github:o/r#v0.2.0')
    expect(withRef('github:o/r', 'v0.2.0')).toBe('github:o/r#v0.2.0')
  })
})

describe('update arguments', () => {
  it('reads now, explicit tags and plugin names', () => {
    expect(parseUpdateArgs([])).toEqual({ now: false })
    expect(parseUpdateArgs(['now'])).toEqual({ now: true })
    expect(parseUpdateArgs(['to', 'v0.13.1', 'now'])).toEqual({ now: true, version: 'v0.13.1' })
    expect(parseUpdateArgs(['v0.13.1'])).toEqual({ now: false, version: 'v0.13.1' })
    expect(parseUpdateArgs(['dsh-penpot-plugin'], { name: true })).toEqual({ now: false, name: 'dsh-penpot-plugin' })
    expect(parseUpdateArgs(['dsh-penpot-plugin', 'to', '0.3.1'], { name: true })).toEqual({
      now: false,
      name: 'dsh-penpot-plugin',
      version: '0.3.1',
    })
  })

  it('rejects unparseable tails instead of guessing', () => {
    expect(parseUpdateArgs(['to'])).toBeUndefined()
    expect(parseUpdateArgs(['to', 'main'])).toBeUndefined()
    expect(parseUpdateArgs(['dsh-penpot-plugin', 'now', 'extra'])).toBeUndefined()
  })
})

describe('release resolution', () => {
  it('picks the newest tag and builds the install spec', async () => {
    const fetchImpl = fakeFetch(['v0.13.0', 'v0.13.1', 'v0.12.9', 'nightly'], {
      version: '0.13.1',
      peerDependencies: { '@deepseek-ai/dsh-agent': '>=0.1.0-rc.6 <0.3.0-0' },
    })
    const previous = process.env.DSH_RUNTIME_VERSION
    process.env.DSH_RUNTIME_VERSION = '0.2.1-rc.5'
    try {
      const lookup = await resolveRelease('github:o/dsh-telegram-connector#v0.12.9', { fetchImpl })
      expect(lookup.problem).toBeUndefined()
      expect(lookup.release).toMatchObject({
        tag: 'v0.13.1',
        version: '0.13.1',
        spec: 'github:o/dsh-telegram-connector#v0.13.1',
        compatible: true,
      })
      expect(await latestTag({ owner: 'o', repo: 'r' }, fetchImpl)).toBe('v0.13.1')
    } finally {
      if (previous === undefined) delete process.env.DSH_RUNTIME_VERSION
      else process.env.DSH_RUNTIME_VERSION = previous
    }
  })

  it('refuses a tag whose declared DSH range excludes this runtime', async () => {
    const fetchImpl = fakeFetch(['v0.14.0'], {
      peerDependencies: { '@deepseek-ai/dsh-agent': '>=0.3.0-0 <0.4.0-0' },
    })
    const previous = process.env.DSH_RUNTIME_VERSION
    process.env.DSH_RUNTIME_VERSION = '0.2.1-rc.5'
    try {
      const lookup = await resolveRelease('github:o/r', { fetchImpl })
      expect(lookup.release).toBeUndefined()
      expect(lookup.problem).toContain('does not satisfy')
    } finally {
      if (previous === undefined) delete process.env.DSH_RUNTIME_VERSION
      else process.env.DSH_RUNTIME_VERSION = previous
    }
  })

  it('honours an explicit tag without listing releases', async () => {
    const fetchImpl = fakeFetch([], { peerDependencies: { '@deepseek-ai/dsh-agent': '>=0.1.0-rc.6 <0.3.0-0' } })
    const previous = process.env.DSH_RUNTIME_VERSION
    process.env.DSH_RUNTIME_VERSION = '0.2.1-rc.5'
    try {
      const lookup = await resolveRelease('github:o/r#v0.1.0', { explicit: '0.13.2', fetchImpl })
      expect(lookup.release?.tag).toBe('v0.13.2')
      expect(lookup.release?.spec).toBe('github:o/r#v0.13.2')
    } finally {
      if (previous === undefined) delete process.env.DSH_RUNTIME_VERSION
      else process.env.DSH_RUNTIME_VERSION = previous
    }
  })

  it('reports a host-managed source instead of guessing a repository', async () => {
    expect((await resolveRelease('dsh-penpot-plugin ^0.3.0')).problem).toContain('not installed from GitHub')
  })
})
