/**
 * Version and compatibility information, for `/about` and for support.
 *
 * The connector's own version comes from its package manifest. The runtime
 * version is best-effort: our Docker image exports `DSH_RUNTIME_VERSION`, and a
 * direct install can still resolve the harness packages.
 *
 * @module dsh-telegram-connector/about
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

export const PEER_PACKAGE = '@deepseek-ai/dsh-agent'

interface Manifest {
  version?: string
  peerDependencies?: Record<string, string>
}

function manifest(): Manifest {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Manifest
  } catch {
    return {}
  }
}

export function connectorVersion(): string {
  return manifest().version ?? 'unknown'
}

/** The peer range this connector declares against the harness packages. */
export function supportedRange(): string | undefined {
  return manifest().peerDependencies?.[PEER_PACKAGE]
}

/** Environment first (the image sets it), then the installed peer package. */
export function runtimeVersion(): string | undefined {
  const fromEnv = process.env.DSH_RUNTIME_VERSION
  if (fromEnv !== undefined && fromEnv.trim().length > 0) return fromEnv.trim()
  try {
    const require = createRequire(import.meta.url)
    const pkg = require(`${PEER_PACKAGE}/package.json`) as { version?: string }
    return pkg.version
  } catch {
    return undefined
  }
}
