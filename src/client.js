/**
 * Browser half: the configuration page for the `dsh-telegram-connector` row.
 *
 * DSH's Plugins page declares the `plugins.row.config` slot; this module
 * registers the row's page with the values a fresh standalone install needs.
 * The host half reads the same volatile keys from its Config schema; the patch
 * keeps the environment as the fallback, and a value saved here is the
 * profile's user layer, which wins over it.
 */
window.__ModuleLoader__.load({
  id: 'dsh-telegram-connector',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    const KEY = 'dsh-telegram-connector#dsh-telegram-connector'
    const styles = `
.dsh-telegram-form { display: flex; flex-direction: column; gap: 16px; max-width: 560px; color: var(--dsw-alias-label-primary); font-size: 13px; }
.dsh-telegram-form .panel { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-layer-2); }
.dsh-telegram-form .row { display: flex; align-items: center; gap: 6px; font-weight: 500; }
.dsh-telegram-form .dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); }
.dsh-telegram-form .dot.ok { background: var(--dsw-alias-state-success-primary); }
.dsh-telegram-form .muted { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.45; }
.dsh-telegram-form .field { display: flex; flex-direction: column; gap: 6px; }
.dsh-telegram-form .label { font-weight: 500; }
.dsh-telegram-form .hint { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.4; }
.dsh-telegram-form .input { box-sizing: border-box; width: 100%; min-height: 32px; padding: 6px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; }
.dsh-telegram-form .input:focus { outline: 1px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsh-telegram-form .input:disabled { opacity: 0.6; }
.dsh-telegram-form .actions { display: flex; align-items: center; gap: 10px; }
.dsh-telegram-form .primary { min-height: 32px; padding: 0 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; }
.dsh-telegram-form .primary:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.dsh-telegram-form .primary:disabled { opacity: 0.55; cursor: default; }
.dsh-telegram-form .message { color: var(--dsw-alias-label-secondary); font-size: 12px; }
`

    function Field({ label, hint, children }) {
      return h(
        'label',
        { className: 'field' },
        h('span', { className: 'label' }, label),
        hint === undefined ? null : h('span', { className: 'hint' }, hint),
        children,
      )
    }

    function parseIds(text) {
      const parts = text.split(/[\s,]+/).map((part) => part.trim()).filter((part) => part.length > 0)
      const ids = []
      for (const part of parts) {
        const id = Number(part)
        if (!Number.isInteger(id) || id <= 0) return undefined
        ids.push(id)
      }
      return ids
    }

    function TelegramConfigForm({ form }) {
      // Every hook runs before any early return: the page transitions through
      // loading/unavailable snapshots and a conditional hook would crash React.
      const state = form === undefined ? undefined : form.state
      const value = (state === undefined ? undefined : state.value) ?? {}
      const [botToken, setBotToken] = React.useState(String(value.botToken ?? ''))
      const [allowed, setAllowed] = React.useState(
        Array.isArray(value.allowedUserIds) ? value.allowedUserIds.join(', ') : '',
      )
      const [admin, setAdmin] = React.useState(
        value.adminUserId === undefined ? '' : String(value.adminUserId),
      )
      const [saving, setSaving] = React.useState(false)
      const [message, setMessage] = React.useState('')

      const revision = state === undefined ? undefined : state.revision
      React.useEffect(() => {
        const next = state === undefined ? {} : (state.value ?? {})
        setBotToken(String(next.botToken ?? ''))
        setAllowed(Array.isArray(next.allowedUserIds) ? next.allowedUserIds.join(', ') : '')
        setAdmin(next.adminUserId === undefined ? '' : String(next.adminUserId))
      }, [revision])

      if (state === undefined) {
        return h('p', null, 'Loading the configuration…')
      }
      if (state.status === 'unavailable') {
        return h('p', null, 'This plugin is not loaded, so it cannot be configured right now.')
      }
      if (state.status === 'loading') {
        return h('p', null, 'Loading the current values…')
      }

      const savedToken = String(value.botToken ?? '')
      const savedAllowed = Array.isArray(value.allowedUserIds) ? value.allowedUserIds : []
      const savedAdmin = value.adminUserId
      const tokenSet = savedToken.trim().length > 0
      const configured = tokenSet && savedAllowed.length > 0
      const disabled = !state.writable || saving
      const saved = state.user ?? {}
      const source = (key) => (Object.prototype.hasOwnProperty.call(saved, key) ? 'saved here' : 'environment fallback')

      const save = async () => {
        const ids = parseIds(allowed)
        if (ids === undefined) {
          setMessage('Allowed user ids must be positive integers, separated by commas or spaces.')
          return
        }
        const adminText = admin.trim()
        const adminId = adminText.length === 0 ? undefined : Number(adminText)
        if (adminId !== undefined && (!Number.isInteger(adminId) || adminId <= 0)) {
          setMessage('The admin user id must be a positive integer, or empty to use the first allowed id.')
          return
        }
        setSaving(true)
        setMessage('')
        try {
          const ops = [
            { op: 'set', path: ['botToken'], value: botToken.trim() },
            { op: 'set', path: ['allowedUserIds'], value: ids },
            adminId === undefined
              ? { op: 'unset', path: ['adminUserId'] }
              : { op: 'set', path: ['adminUserId'], value: adminId },
          ]
          const ok = await form.mutate(ops, state.revision)
          if (!ok) {
            setMessage('The runtime did not accept these values; they were left for you to correct.')
          } else if (botToken.trim().length === 0 || ids.length === 0) {
            setMessage('Saved. Set a bot token and at least one allowed user id to start the connector.')
          } else {
            setMessage('Saved. The connector uses these values immediately.')
          }
        } catch (error) {
          setMessage(`Save failed: ${String(error)}`)
        } finally {
          setSaving(false)
        }
      }

      return h(
        'div',
        { className: 'dsh-telegram-form' },
        h('style', null, styles),
        h(
          'div',
          { className: 'panel' },
          h(
            'div',
            { className: 'row' },
            h('span', { className: configured ? 'dot ok' : 'dot' }),
            h('span', null, configured ? 'Configured' : 'Not configured yet'),
          ),
          h(
            'div',
            { className: 'muted' },
            `Bot token ${tokenSet ? 'set' : 'not set'} · ${savedAllowed.length} allowed user(s) · admin ${savedAdmin === undefined ? 'first allowed' : String(savedAdmin)}`,
          ),
          h(
            'div',
            { className: 'muted' },
            `Bot token: ${source('botToken')} · allowed ids: ${source('allowedUserIds')} · admin: ${source('adminUserId')}`,
          ),
          h('div', { className: 'muted' }, 'Saving writes this profile and applies without restarting the runtime.'),
        ),
        h(
          Field,
          {
            label: 'Bot token',
            hint: 'The token from @BotFather. It is stored in this profile; avoid screenshots and commits.',
          },
          h('input', {
            type: 'password',
            className: 'input',
            value: botToken,
            disabled,
            placeholder: '123456789:AA…',
            onChange: (event) => setBotToken(event.target.value),
          }),
        ),
        h(
          Field,
          {
            label: 'Allowed user ids',
            hint: 'Numeric Telegram ids, comma or space separated. Everyone here can talk to the agent and use its sessions.',
          },
          h('input', {
            type: 'text',
            className: 'input',
            value: allowed,
            disabled,
            placeholder: '142283532, 777000111',
            onChange: (event) => setAllowed(event.target.value),
          }),
        ),
        h(
          Field,
          {
            label: 'Admin user id',
            hint: 'Optional. One allowed id that may update, restart, roll back and manage plugins; empty uses the first allowed id.',
          },
          h('input', {
            type: 'text',
            className: 'input',
            value: admin,
            disabled,
            placeholder: 'optional',
            onChange: (event) => setAdmin(event.target.value),
          }),
        ),
        h(
          'div',
          { className: 'actions' },
          h(
            'button',
            {
              type: 'button',
              className: 'primary',
              disabled,
              onClick: save,
            },
            saving ? 'Saving…' : 'Save',
          ),
          message.length === 0 ? null : h('span', { className: 'message' }, message),
        ),
      )
    }

    const inject = ['slots']
    function apply(ctx) {
      ctx.slots.inject('plugins.row.config', () =>
        ctx.slots.register(
          { name: 'plugins.row.config', key: KEY },
          ({ view, form }) => (view === 'summary' ? null : h(TelegramConfigForm, { form })),
        ),
      )
    }

    exports.NS = 'dsh-telegram-connector'
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
