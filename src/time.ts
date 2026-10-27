/**
 * Time zones.
 *
 * Display is Telegram's job: `<tg-time>` is rendered in the reader's own zone.
 * Input is different — “tomorrow at 9:00” needs exactly one zone to be turned
 * into a UTC instant — so one zone is stored with the bindings, defaults to
 * `$DSH_TIMEZONE`, and is used by anything that parses human time.
 *
 * @module dsh-telegram-connector/time
 */

export const DEFAULT_TIME_ZONE = 'UTC'

/** The zone name if the runtime accepts it, otherwise undefined. */
export function validTimeZone(name: string): string | undefined {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name }).format(0)
    return name
  } catch {
    return undefined
  }
}

/** A stored zone wins over the environment; an unusable value falls back to UTC. */
export function resolveTimeZone(stored: string | undefined, fromEnv: string | undefined): string {
  for (const candidate of [stored, fromEnv]) {
    if (candidate === undefined) continue
    const zone = validTimeZone(candidate)
    if (zone !== undefined) return zone
  }
  return DEFAULT_TIME_ZONE
}
