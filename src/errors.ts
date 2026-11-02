/**
 * Session-ownership errors.
 *
 * The runtime lets exactly one client hold a session's write handle; a second
 * `create`/`resume` is refused with "already owned by an active write handle".
 * A closed browser tab does not always release it, and nothing in the agent API
 * lets a third party dispose another owner's handle — the only in-product
 * recovery is a runtime restart, which clears every agent.
 *
 * @module dsh-telegram-connector/errors
 */

/** True when the runtime refused because another client owns the session. */
export function isOwnershipError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error)
  return /active write handle|already owned/i.test(text)
}

/**
 * What to tell the user. The advice is deliberate: "close the tab" alone is not
 * enough when a tab was closed without releasing the handle.
 */
export const OWNERSHIP_HINT =
  'this session is held by another client (a web UI tab). If no tab is open, send `/system restart now` to clear it — a restart releases every session handle. `/new` in General also works for a fresh session.'
