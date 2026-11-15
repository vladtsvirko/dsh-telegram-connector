/**
 * Read-only view of the optional host toolchains installed by the setup.
 *
 * The connector runs as the same `dsh` user as xtool, so it can report SDK and
 * Apple-login state without root. Installs, removals and SDK extraction are
 * root work and go through the updater; this module never changes anything.
 *
 * @module dsh-telegram-connector/devtools
 */

import { execFile } from 'node:child_process'
import { readdir, statfs } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export interface DevtoolsJob {
  id?: string
  kind?: string
  action?: string
  tools?: string
  path?: string
  slim?: boolean
  state?: string
  stage?: string
  startedAt?: string
  finishedAt?: string
  exitCode?: number
  logTail?: string
  error?: string
  timeoutSeconds?: number
  cancelled?: boolean
  timedOut?: boolean
}

export interface DevtoolsTool {
  id: 'ios' | 'android'
  label: string
  installed: boolean
  versions: string[]
  /** iOS only. */
  sdk?: string
  /** iOS only: logged-in / logged-out / unknown. */
  auth?: string
  /** A one-line reason when requested but not installed. */
  missing?: string
}

export interface DevtoolsStatus {
  requested: string
  tools: DevtoolsTool[]
  diskFreeGb?: number
  job?: DevtoolsJob
  at: number
}

export interface ReadStatusOptions {
  root?: string
  requested?: string
  job?: DevtoolsJob
  /** Injected in tests. */
  list?: (path: string) => Promise<string[]>
  run?: (command: string, args: string[]) => Promise<string>
  disk?: (path: string) => Promise<number | undefined>
  now?: () => number
}

const TERMINAL = new Set(['done', 'failed', 'rolled-back', 'cancelled'])

export function jobActive(job: DevtoolsJob | undefined): boolean {
  return job !== undefined && job.state !== undefined && !TERMINAL.has(job.state)
}

export function normalizeRequested(value: string | undefined): string {
  const raw = (value ?? '').trim().toLowerCase()
  if (raw === '' || raw === 'none') return 'none'
  if (raw === 'all') return 'ios,android'
  const parts: string[] = raw.split(',').map((part) => part.trim()).filter((part) => part === 'ios' || part === 'android')
  const ordered = ['ios', 'android'].filter((part) => parts.includes(part))
  return ordered.length === 0 ? 'none' : ordered.join(',')
}

export function requestedHas(requested: string, tool: string): boolean {
  return requested.split(',').includes(tool as 'ios' | 'android')
}

async function defaultList(path: string): Promise<string[]> {
  return readdir(path).catch(() => [])
}

async function defaultRun(command: string, args: string[]): Promise<string> {
  const result = await exec(command, args, { timeout: 5000, maxBuffer: 32768 })
  return String(result.stdout ?? '') + String(result.stderr ?? '')
}

async function defaultDisk(path: string): Promise<number | undefined> {
  try {
    const info = await statfs(path)
    return Math.max(0, Math.round((Number(info.bavail) * Number(info.bsize)) / 1_000_000_000))
  } catch {
    return undefined
  }
}

function versionOf(entries: string[], prefix: string): string | undefined {
  const found = entries
    .filter((entry) => entry.startsWith(prefix))
    .map((entry) => entry.slice(prefix.length))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
  return found.at(-1)
}

function sdkLine(output: string): { sdk?: string; installed: boolean } {
  const installed = /Darwin SDK is installed/i.test(output)
  const version = /Version:\s*(.+)/i.exec(output)?.[1]?.trim()
  return { installed, ...(version === undefined ? {} : { sdk: version }) }
}

function authLine(output: string): string {
  if (/Logged in/i.test(output)) {
    const id = /Apple ID:\s*(.+)/i.exec(output)?.[1]?.trim()
    return id === undefined ? 'logged in' : `logged in as ${id}`
  }
  if (/Logged out/i.test(output)) return 'logged out'
  return 'unknown'
}

/** Read the filesystem and run the two read-only xtool commands. */
export async function readDevtoolsStatus(options: ReadStatusOptions = {}): Promise<DevtoolsStatus> {
  const root = options.root ?? '/opt/dsh-devtools'
  const requested = normalizeRequested(options.requested ?? process.env.DSH_DEVTOOLS)
  const list = options.list ?? defaultList
  const run = options.run ?? defaultRun
  const disk = options.disk ?? defaultDisk
  const at = (options.now ?? Date.now)()
  const top = await list(root)
  const swift = versionOf(top, 'swift-')
  const xtool = versionOf(top, 'xtool-')
  const iosInstalled = swift !== undefined && xtool !== undefined
  let sdk: string | undefined
  let auth = 'unknown'
  if (iosInstalled) {
    const xtoolBin = '/usr/local/bin/xtool'
    try {
      const status = sdkLine(await run(xtoolBin, ['sdk', 'status']))
      if (status.installed) sdk = 'installed'
    } catch {
      // A missing or unrunnable launcher leaves the SDK unknown.
    }
    try {
      auth = authLine(await run(xtoolBin, ['auth', 'status']))
    } catch {
      auth = 'unknown'
    }
  }

  const sdkRoot = join(root, 'android-sdk')
  const androidTop = await list(sdkRoot)
  const androidInstalled = ['cmdline-tools', 'platforms', 'build-tools', 'ndk'].every((entry) => androidTop.includes(entry))
  const platforms = versionOf(await list(join(sdkRoot, 'platforms')), 'android-')
  const buildTools = versionOf(await list(join(sdkRoot, 'build-tools')), '')
  const ndk = versionOf(await list(join(sdkRoot, 'ndk')), '')
  const java = process.env.JAVA_HOME === undefined ? undefined : basename(process.env.JAVA_HOME)

  const tools: DevtoolsTool[] = []
  const ios: DevtoolsTool = {
    id: 'ios',
    label: 'iOS',
    installed: iosInstalled,
    versions: [
      ...(swift === undefined ? [] : [`swift ${swift}`]),
      ...(xtool === undefined ? [] : [`xtool ${xtool}`]),
    ],
    ...(sdk === undefined ? {} : { sdk }),
    ...(iosInstalled ? { auth } : {}),
    ...(requestedHas(requested, 'ios') && !iosInstalled ? { missing: 'requested but not installed' } : {}),
  }
  tools.push(ios)
  const android: DevtoolsTool = {
    id: 'android',
    label: 'Android',
    installed: androidInstalled,
    versions: [
      ...(platforms === undefined ? [] : [`SDK ${platforms}`]),
      ...(buildTools === undefined ? [] : [`build-tools ${buildTools}`]),
      ...(ndk === undefined ? [] : [`NDK ${ndk}`]),
      ...(java === undefined ? [] : [`JDK ${java.replace(/^java-/, '').replace(/-openjdk.*$/, '')}`]),
    ],
    ...(requestedHas(requested, 'android') && !androidInstalled ? { missing: 'requested but not installed' } : {}),
  }
  tools.push(android)

  return {
    requested,
    tools,
    ...(await disk(root).then((value) => value === undefined ? {} : { diskFreeGb: value })),
    ...(options.job === undefined ? {} : { job: options.job }),
    at,
  }
}
