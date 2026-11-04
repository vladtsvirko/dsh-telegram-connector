/**
 * Session-ownership errors.
 *
 * The runtime lets exactly one client hold a session's write handle; a second
 * `create`/`resume` is refused with "already owned by an active write handle".
 * Who holds it decides what the user should do, and the connector can tell the
 * three cases apart:
 *
 *   * a **web UI tab** in this same runtime — normal, and the tab is visible;
 *   * **another topic** of the same bot — the connector holds its own session
 *     twice, and the fix is in Telegram, not a restart;
 *   * a **second runtime** over the same data directory — a native service left
 *     running beside another service, or two checkouts on one directory.
 *     Restarting one does not help: the other process keeps the kernel lock.
 *
 * The old advice said "a web UI tab" for all three, so a user with two runtimes
 * was told to close a tab that did not exist, and `/system restart now` did not
 * clear it. A closed tab also does not always release the handle, so the restart
 * advice stays — but only when it can actually work.
 *
 * @module dsh-telegram-connector/errors
 */

/** The runtime refused because another client holds the session's write handle. */
export class SessionHeldError extends Error {
  constructor(message: string = OWNERSHIP_HINT) {
    super(message)
    this.name = 'SessionHeldError'
  }
}

/** True when the runtime refused because another client owns the session. */
export function isOwnershipError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error)
  return /active write handle|already owned/i.test(text)
}

/**
 * What to tell the user when the holder is this runtime's web UI or an
 * unidentified one. The advice is deliberate: "close the tab" alone is not
 * enough when a tab was closed without releasing the handle.
 */
export const OWNERSHIP_HINT =
  'this session is held by another client (a web UI tab). **Take over** asks for confirmation, then restarts dsh and releases every session handle — it interrupts every running task, not only this one. `/system restart now` does the same without the prompt. `/new` in General also works for a fresh session.'

/** The same bot holds this session in another topic: no restart, use that topic. */
export function heldByAnotherTopic(threadId: number): string {
  return `this session is already open in topic ${String(threadId)} of this group — that topic owns it. Send there, or run \`/forget\` here to drop this binding; a restart will not change it.`
}

/**
 * Nothing in this process holds the session, so a second runtime over the same
 * data directory does. Restarting this one cannot help.
 */
export const HELD_BY_OTHER_RUNTIME =
  'this session is held by another process, not by a tab in this runtime. Two dsh runtimes are sharing one data directory — a second checkout, or a hand-started dsh beside the service. Stop the other one (`sudo systemctl stop dsh.service`), then `/system restart now`; `./install.sh --doctor` names the holder.'

/** The holder is this runtime, but no topic claims it: a leaked handle. */
export const HELD_BY_ORPHAN =
  'this session is held by an agent in this runtime that no topic owns (a leaked handle from an earlier failure). Only a restart releases it: `/system restart now`.'
