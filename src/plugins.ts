/**
 * The plugin surface: types for the host's `pluginManager` service, and the
 * rendering of its answers as Telegram messages.
 *
 * The service is optional (a profile that is not base-backed does not mount it),
 * and its results are read defensively — every field is optional here, so a
 * runtime that reports a little less still produces a useful message instead of
 * an exception.
 *
 * @module dsh-telegram-connector/plugins
 */

/** Host display text: a literal string, or per-locale strings with `en` required. */
export type LocalizedText = string | { readonly en?: string; readonly [locale: string]: string | undefined }

export interface BundleRowInfo {
  rowId: string
  moduleName: string
  entryId?: string
}

export interface IncompatiblePlugin {
  name: string
  version: string
  runtimeVersion: string
  requirements: Record<string, string>
}

export interface ManagementErrorInfo {
  code: string
  diagnostic?: string
  incompatible?: IncompatiblePlugin[]
}

/** One bundle as `pluginManager.listBundles()` reports it. */
export interface BundleInfo {
  name: string
  version?: string
  enabled: boolean
  installed: boolean
  removable?: boolean
  official?: boolean
  optional?: boolean
  availability?: 'profile' | 'installation' | 'missing'
  description?: string
  source?: string
  installTarget?: { spec: string; version: string }
  meta?: { title?: LocalizedText; description?: LocalizedText }
  rows?: BundleRowInfo[]
  overrides?: string[]
  error?: ManagementErrorInfo
  readOnlyReason?: string
}

export interface PackageResultInfo {
  exitCode: number
  output: string
  truncated?: boolean
  logPath?: string
  kind?: string
  timedOut?: boolean
}

/** The outcome of an install/remove/enable operation. */
export interface ChangeResult {
  changed: boolean
  application: 'applied' | 'restart-required' | 'failed' | 'cancelled' | 'overridden'
  restartReason?: string
  stage?: string
  target?: string
  enabled?: boolean
  error?: ManagementErrorInfo
  warnings?: string[]
  packageResult?: PackageResultInfo
  bundle?: string
  version?: string
  pendingBuilds?: string[]
  approvedBuilds?: string[]
}

/** What `inspect` found about a spec, before anything runs. */
export interface Inspection {
  status: 'accepted' | 'refused'
  kind?: 'registry' | 'path' | 'git' | 'tarball'
  name?: string
  version?: string
  description?: string
  bundle?: boolean | null
  registry?: string | null
  host?: string
  problem?: string
  reason?: string
  registries?: (string | null)[]
}

/** The slice of the host service this connector uses. */
export interface PluginManagerService {
  listBundles(): BundleInfo[] | Promise<BundleInfo[]>
  inspect(spec: string, options?: { registry?: string | null }): Promise<Inspection>
  installBundle(spec: string, options?: {
    enabled?: boolean
    saveExact?: boolean
    requestId?: string
    approvedBuilds?: string[]
    registry?: string | null
  }): Promise<ChangeResult>
  removeBundle(name: string): Promise<ChangeResult>
  setBundleEnabled(name: string, enabled: boolean): Promise<ChangeResult>
}

const PROBLEMS: Record<string, string> = {
  'invalid-spec': 'that does not look like a package spec',
  'already-installed': 'it is already installed — remove it first, or update it from the host',
  'not-found': 'no registry had that package',
  'not-a-package': 'the spec resolves to something that is not a package',
  'not-a-bundle': 'the package declares no DSH bundle patch, so there is nothing to mount',
  'network': 'no registry could be reached',
  'unknown': 'the lookup failed',
}

const RESTART_REASONS: Record<string, string> = {
  'no-hmr': 'this runtime does not reload plugins live',
  'package-moved': 'the package now resolves to another directory',
  'host-module': 'a host module changed',
  'unmanaged-plugin': 'the plugin was loaded outside the profile',
  'module-comparison': 'a changed module loads only at startup',
}

const MAX_LIST_ROWS = 40

/** Read display text regardless of whether the host sent a string or locales. */
export function localized(value: LocalizedText | undefined): string | undefined {
  if (typeof value === 'string') return value.trim().length === 0 ? undefined : value.trim()
  if (value === undefined || value === null) return undefined
  if (typeof value.en === 'string' && value.en.trim().length > 0) return value.en.trim()
  for (const candidate of Object.values(value)) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim()
  }
  return undefined
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

const limit = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`

/** Keep the end of a long output: pnpm prints its error last. */
const tail = (text: string, max: number): string => {
  const clean = text.trim()
  return clean.length <= max ? clean : `…${clean.slice(-(max - 1))}`
}

/** A code span, safe against embedded backticks. */
const code = (text: string): string => `\`${oneLine(text).replace(/`/g, '')}\``

const byName = (left: BundleInfo, right: BundleInfo): number => left.name.localeCompare(right.name)

function bundleLine(bundle: BundleInfo): string {
  const version = bundle.version === undefined ? '' : ` ${bundle.version}`
  const notes: string[] = []
  if (bundle.optional === true) notes.push('optional')
  if (bundle.error !== undefined) notes.push(`⚠️ ${bundle.error.code}`)
  const suffix = notes.length === 0 ? '' : ` — ${notes.join(', ')}`
  return `${code(bundle.name)}${version}${suffix}`
}

/** `/plugins`: the profile's bundles, grouped by what can be done with them. */
export function describeBundleList(bundles: readonly BundleInfo[]): string {
  if (bundles.length === 0) return 'no bundles are installed in this profile.'

  const enabled = bundles.filter((bundle) => bundle.enabled).sort(byName)
  const disabled = bundles.filter((bundle) => !bundle.enabled && bundle.installed).sort(byName)
  const available = bundles.filter((bundle) => !bundle.enabled && !bundle.installed).sort(byName)

  const lines = [
    `**plugins** · ${enabled.length} enabled · ${disabled.length} disabled · ${available.length} available`,
  ]
  let shown = 0
  const section = (title: string, rows: readonly BundleInfo[], mark: string): void => {
    if (rows.length === 0 || shown >= MAX_LIST_ROWS) return
    lines.push('', `**${title}**`)
    for (const bundle of rows) {
      if (shown >= MAX_LIST_ROWS) return
      lines.push(`${mark} ${bundleLine(bundle)}`)
      shown += 1
    }
  }

  section('enabled', enabled, '✓')
  section('disabled', disabled, '·')
  section('available', available, '+')

  if (bundles.length > shown) lines.push('', `… and ${bundles.length - shown} more`)
  lines.push(
    '',
    '`/plugin info <name>` · `/plugin add <spec>` · `/plugin enable|disable <name>` · `/plugin remove <name>`',
  )
  return lines.join('\n')
}

/** `/plugin info <name>`: one bundle in detail. */
export function describeBundle(bundle: BundleInfo): string {
  const title = localized(bundle.meta?.title)
  const version = bundle.version === undefined ? '' : ` ${bundle.version}`
  const heading = title === undefined || title === bundle.name
    ? `${code(bundle.name)}${version}`
    : `**${title}** · ${code(bundle.name)}${version}`
  const lines = [heading]

  const description = localized(bundle.meta?.description) ?? bundle.description
  if (description !== undefined) lines.push('', limit(oneLine(description), 600))

  const state = [bundle.enabled ? 'enabled' : 'disabled']
  if (bundle.installed) state.push('installed')
  if (bundle.optional === true) state.push('optional')
  if (bundle.official === true) state.push('official')
  if (bundle.availability !== undefined) state.push(bundle.availability)
  if (bundle.readOnlyReason !== undefined) state.push(`locked: ${bundle.readOnlyReason}`)
  lines.push('', state.join(' · '))

  if (bundle.source !== undefined) lines.push(`source: ${code(bundle.source)}`)
  if (bundle.installTarget !== undefined) {
    lines.push(`install: \`/plugin add ${oneLine(bundle.installTarget.spec).replace(/`/g, '')}\``)
  }

  const rows = bundle.rows ?? []
  if (rows.length > 0) {
    const shown = rows.slice(0, 12).map((row) => code(row.rowId))
    const more = rows.length > 12 ? ` … +${rows.length - 12}` : ''
    lines.push(`rows: ${shown.join(', ')}${more}`)
  }
  const overrides = bundle.overrides ?? []
  if (overrides.length > 0) {
    const shown = overrides.slice(0, 12).map((id) => code(id))
    const more = overrides.length > 12 ? ` … +${overrides.length - 12}` : ''
    lines.push(`overrides: ${shown.join(', ')}${more}`)
  }

  if (bundle.error !== undefined) {
    const diagnostic = bundle.error.diagnostic === undefined
      ? ''
      : ` — ${limit(oneLine(bundle.error.diagnostic), 300)}`
    lines.push('', `⚠️ **${bundle.error.code}**${diagnostic}`)
  }

  return lines.join('\n')
}

/** The inspection half of `/plugin add`: what will be installed, or why it will not. */
export function describeInspection(inspection: Inspection): string {
  if (inspection.status === 'refused') {
    const problem = PROBLEMS[inspection.problem ?? 'unknown'] ?? PROBLEMS.unknown ?? 'the lookup failed'
    const lines = [`**cannot install** — ${problem}`]
    if (inspection.reason !== undefined && inspection.reason.trim().length > 0) {
      lines.push('', limit(oneLine(inspection.reason), 500))
    }
    const registries = inspection.registries ?? []
    if (registries.length > 0) {
      const asked = registries.map((registry) => (registry === null ? 'pnpm default' : code(registry)))
      lines.push('', `registries asked: ${asked.join(', ')}`)
    }
    return lines.join('\n')
  }

  const name = inspection.name ?? 'unknown package'
  const version = inspection.version === undefined ? '' : ` ${inspection.version}`
  const lines = [`**install** ${code(name)}${version}`]
  if (inspection.description !== undefined && inspection.description.trim().length > 0) {
    lines.push('', limit(oneLine(inspection.description), 500))
  }

  const facts: string[] = []
  if (inspection.kind !== undefined) facts.push(inspection.kind)
  if (inspection.host !== undefined) facts.push(code(inspection.host))
  if (inspection.registry !== undefined && inspection.registry !== null) facts.push(code(inspection.registry))
  if (inspection.bundle === true) facts.push('bundle')
  if (facts.length > 0) lines.push('', facts.join(' · '))

  return lines.join('\n')
}

/** The outcome of a mutation, as one message. */
export function describeChange(result: ChangeResult, pastTense: string): string {
  const name = result.bundle ?? result.target ?? 'bundle'
  const version = result.version === undefined ? '' : ` ${result.version}`

  if (result.application === 'failed') {
    const errorCode = result.error?.code ?? 'operation-error'
    const lines = [`**${pastTense} failed** — ${errorCode}`]
    const detail = result.error?.diagnostic ?? result.packageResult?.output
    if (detail !== undefined && detail.trim().length > 0) {
      lines.push('', limit(tail(detail, 700), 700))
    }
    const incompatible = result.error?.incompatible ?? []
    if (incompatible.length > 0) {
      lines.push('')
      for (const plugin of incompatible.slice(0, 5)) {
        const needs = Object.entries(plugin.requirements)
          .map(([key, value]) => `${key} ${value}`)
          .join(', ')
        lines.push(`· \`${plugin.name}@${plugin.version}\` needs ${needs} — running ${plugin.runtimeVersion}`)
      }
      lines.push('', 'the host CLI can grant an exact version exemption if you accept the risk.')
    }
    if (result.packageResult?.logPath !== undefined) {
      lines.push('', `log: ${code(result.packageResult.logPath)}`)
    }
    return lines.join('\n')
  }

  if (result.application === 'cancelled') return `**${pastTense} cancelled** — nothing changed.`

  const head = `${code(name)}${version}`
  const lines: string[] = []
  if (result.application === 'restart-required') {
    const reason = RESTART_REASONS[result.restartReason ?? ''] ?? 'a restart is needed'
    lines.push(`**${pastTense}** ${head} — restart required (${reason}).`)
  } else if (result.application === 'overridden') {
    lines.push(`**${pastTense}** ${head} — applied, but a later configuration layer overrides it.`)
  } else {
    lines.push(`**${pastTense}** ${head}.`)
  }

  if (result.warnings !== undefined && result.warnings.length > 0) {
    lines.push('', `warnings: ${limit(oneLine(result.warnings.slice(0, 3).join('; ')), 400)}`)
  }
  return lines.join('\n')
}
