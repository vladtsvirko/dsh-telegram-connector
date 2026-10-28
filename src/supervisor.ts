/**
 * Client for the container supervisor.
 *
 * The supervisor is a small process between tini and the runtime: it owns
 * restarts and the stable profile snapshot. It is optional — a runtime started
 * directly (`dsh web`, the desktop app) has no supervisor, and the connector
 * then says so instead of pretending a restart is possible.
 *
 * The control socket is loopback-only and bearer-authenticated. Both values
 * come from the environment the deployment entrypoint exports.
 *
 * @module dsh-telegram-connector/supervisor
 */

export interface SupervisorTrial {
  id: string
  armed: boolean
  startedAt: number
  deadline: number | null
}

export interface SupervisorStatus {
  child: 'running' | 'stopped'
  profile?: string
  stable: boolean
  stableAt?: number | null
  trial: SupervisorTrial | null
  trialSeconds?: number
  lastEvent?: { kind: string; at: number; detail?: string } | null
  now?: number
}

export interface OpenTrialResult {
  ok: boolean
  trial?: SupervisorTrial
}

export interface ArmResult {
  ok: boolean
  firstArm?: boolean
  trialId?: string
  deadline?: number | null
  trialSeconds?: number
}

export class SupervisorError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'SupervisorError'
  }
}

const REQUEST_TIMEOUT_MS = 8000

export class SupervisorClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  status(): Promise<SupervisorStatus> {
    return this.request<SupervisorStatus>('/status')
  }

  restart(trial: boolean): Promise<{ ok: boolean }> {
    return this.request('/restart', { trial })
  }

  arm(): Promise<ArmResult> {
    return this.request<ArmResult>('/trial/arm', {})
  }

  /** Reinstall the connector: the supervisor stops the runtime, runs reset-plugin, starts a trial. */
  update(trial = true): Promise<{ ok: boolean }> {
    return this.request('/update', { trial })
  }

  /** Open a trial that does not restart: HMR applied the change, the window is still owed. */
  openTrial(): Promise<OpenTrialResult> {
    return this.request<OpenTrialResult>('/trial/open', {})
  }

  /** Close a trial without restoring: the change never landed, or the manager undid it. */
  abandonTrial(): Promise<{ ok: boolean }> {
    return this.request('/trial/abandon', {})
  }

  commit(): Promise<{ ok: boolean }> {
    return this.request('/trial/commit', {})
  }

  rollback(reason?: string): Promise<{ ok: boolean }> {
    return this.request('/trial/rollback', reason === undefined ? {} : { reason })
  }

  private async request<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const text = await response.text()
    let parsed: unknown
    try {
      parsed = text.length === 0 ? {} : JSON.parse(text)
    } catch {
      parsed = { error: text }
    }
    if (!response.ok) {
      const detail = (parsed as { error?: unknown }).error
      throw new SupervisorError(
        response.status,
        typeof detail === 'string' && detail.length > 0 ? detail : `supervisor answered ${response.status}`,
      )
    }
    return parsed as T
  }
}

export type TrialAction = 'commit' | 'rollback'

/** `trial:<action>:<id>` — short enough for Telegram's 64-byte callback_data. */
export function parseTrialCallback(data: string | undefined): { action: TrialAction; trialId: string } | undefined {
  if (data === undefined) return undefined
  const [scope, action, trialId] = data.split(':')
  if (scope !== 'trial' || (action !== 'commit' && action !== 'rollback')) return undefined
  if (trialId === undefined || trialId.length === 0) return undefined
  return { action, trialId }
}

export function trialCallbackData(action: TrialAction, trialId: string): string {
  return `trial:${action}:${trialId}`
}

/**
 * A deadline in the reader's own clock. Telegram's `<tg-time>` renders both
 * parts client-side; the fallback text (UTC) is what older clients show.
 */
export function deadlineText(deadline: number, now = Date.now()): string {
  const unix = Math.floor(deadline / 1000)
  const minutes = Math.max(0, Math.round((deadline - now) / 60000))
  const fallback = `${new Date(deadline).toISOString().slice(11, 16)} UTC`
  return `<tg-time unix="${unix}" format="r">in ${minutes} min</tg-time> (at <tg-time unix="${unix}" format="t">${fallback}</tg-time>)`
}
