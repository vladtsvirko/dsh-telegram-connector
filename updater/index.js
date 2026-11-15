/**
 * dsh-plugin-updater — the stable actor for plugin updates.
 *
 * The Telegram connector calls `pluginUpdater.update()`; this plugin talks to
 * the plugin manager (remove + install, HMR) and the supervisor (trial), and
 * survives while the connector or any other target is replaced. It is a
 * separate bundle precisely so it is never the target of its own operation.
 *
 * @module dsh-plugin-updater
 */

export const name = 'plugin-updater'
export const inject = ['pluginManager']

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function post(pathInfo, body) {
  const url = (process.env.DSH_SUPERVISOR_URL ?? '').replace(/\/$/, '')
  const token = process.env.DSH_SUPERVISOR_TOKEN ?? ''
  if (url.length === 0 || token.length === 0) throw new Error('no supervisor is configured')
  const response = await fetch(`${url}${pathInfo}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`supervisor ${pathInfo} returned ${String(response.status)}${detail.length === 0 ? '' : `: ${detail.slice(0, 200)}`}`)
  }
  return response.json().catch(() => ({}))
}

async function sendTrialCard(chatId, text, trialId) {
  const token = process.env.DSH_TELEGRAM_BOT_TOKEN ?? ''
  if (token.length === 0 || chatId === undefined || chatId === null) return
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[
            { text: 'Commit', callback_data: `trial:commit:${trialId}` },
            { text: 'Roll back', callback_data: `trial:rollback:${trialId}` },
          ]],
        },
      }),
      signal: AbortSignal.timeout(10000),
    })
  } catch {
    // The connector's own card is the fallback for a connector update; for
    // other plugins the supervisor still holds the trial.
  }
}

async function notify(chatId, text) {
  const token = process.env.DSH_TELEGRAM_BOT_TOKEN ?? ''
  if (token.length === 0 || chatId === undefined || chatId === null) return
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10000),
    })
  } catch {
    // Progress is best effort; the trial card is the durable notice.
  }
}

export function apply(ctx) {
  let busy = false

  const runUpdate = async (request) => {
    const manager = ctx.get('pluginManager')
    if (manager === undefined) throw new Error('the plugin manager is not mounted')
    const { name: target, spec, chatId, label, announce } = request
    const opened = await post('/trial/open')
    const trial = opened?.trial
    await notify(chatId, `reloading ${label ?? target} live — no restart. The bot is back in a few seconds; the commit card follows.`)
    try {
      const removed = await manager.removeBundle(target)
      if (removed.application !== 'applied') {
        await post('/trial/abandon').catch(() => undefined)
        await notify(chatId, `${label ?? target} needs a restart (${String(removed.application)}); restarting dsh to apply it.`)
        await post('/update', { trial: true, ref: spec })
        return
      }
      await sleep(800)
      const installed = await manager.installBundle(spec, { enabled: true, saveExact: true })
      if (installed.application !== 'applied') {
        await post('/trial/abandon').catch(() => undefined)
        await post('/update', { trial: true, ref: spec })
        return
      }
      if (announce !== false && trial?.id !== undefined) {
        const minutes = typeof trial.deadline === 'number'
          ? Math.max(1, Math.round((trial.deadline - Date.now()) / 60000))
          : undefined
        await sendTrialCard(
          chatId,
          `updated ${label ?? target} — the new version is live.\n\ncommit it below, or put the previous state back${minutes === undefined ? '' : `; otherwise it rolls back in ${String(minutes)}m`}.`,
          trial.id,
        )
      }
    } catch (error) {
      await notify(chatId, `the live reload failed: ${String(error)}; rolling back.`)
      await post('/trial/rollback', { reason: `live plugin update failed: ${String(error)}` }).catch(() => undefined)
    }
  }

  ctx.provide('pluginUpdater', {
    version: '0.2.0',
    /**
     * Start an update. Returns false when this runtime cannot run it, so the
     * caller can fall back to its own path.
     */
    update(request) {
      if (busy) return false
      if (process.env.DSH_SUPERVISOR_URL === undefined || process.env.DSH_SUPERVISOR_TOKEN === undefined) return false
      busy = true
      void runUpdate(request)
        .catch((error) => notify(request.chatId, `update failed: ${String(error)}`))
        .finally(() => { busy = false })
      return true
    },
    /** For channels that want to report what is currently running. */
    busy() {
      return busy
    },
  })
}
