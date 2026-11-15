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

  const retry = async (operation) => {
    let last
    for (let attempt = 0; attempt < 3; attempt += 1) {
      last = await operation()
      if (last.application !== 'failed') return last
      await sleep(1000)
    }
    return last
  }

  const runUpdate = async (request) => {
    const manager = ctx.get('pluginManager')
    if (manager === undefined) throw new Error('the plugin manager is not mounted')
    const { name: target, spec, chatId, label, announce, previous } = request
    const isConnector = target === 'dsh-telegram-connector'
    const opened = await post('/trial/open')
    const trial = opened?.trial
    await notify(chatId, `reloading ${label ?? target} live — no restart. The bot is back in a few seconds; the commit card follows.`)
    try {
      const removed = await retry(() => manager.removeBundle(target))
      if (removed.application === 'failed') {
        await post('/trial/abandon').catch(() => undefined)
        await notify(chatId, `${label ?? target}: remove failed — nothing changed. Try again, or update from the Web UI.`)
        return
      }
      await sleep(800)
      const installed = await retry(() => manager.installBundle(spec, { enabled: true, saveExact: true }))
      if (installed.application === 'failed') {
        if (typeof previous === 'string' && previous.length > 0) {
          const restored = await manager.installBundle(previous, { enabled: true, saveExact: true }).catch(() => undefined)
          if (restored !== undefined && restored.application !== 'failed') {
            await post('/trial/abandon').catch(() => undefined)
            await notify(chatId, `${label ?? target}: install failed; the previous version is back in place.`)
            return
          }
        }
        await notify(chatId, `${label ?? target}: install failed — nothing is committed.`)
        return
      }
      if (removed.application === 'applied' && installed.application === 'applied') {
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
        return
      }
      // The package change is on disk but the running process needs a restart.
      // For a connector target the supervisor must install the connector spec;
      // for any other target the profile already names it, so restart without
      // passing the target as the connector ref.
      await post('/trial/abandon').catch(() => undefined)
      await notify(chatId, `${label ?? target} needs a restart; restarting dsh to apply it.`)
      await post('/update', isConnector ? { trial: true, ref: spec } : { trial: true })
    } catch (error) {
      await notify(chatId, `the live reload failed: ${String(error)}; rolling back.`)
      await post('/trial/rollback', { reason: `live plugin update failed: ${String(error)}` }).catch(() => undefined)
    }
  }

  ctx.provide('pluginUpdater', {
    version: '0.2.1',
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
