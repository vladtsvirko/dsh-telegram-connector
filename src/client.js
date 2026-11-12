/**
 * Browser half: the configuration page for the `dsh-telegram-connector` row.
 *
 * DSH's Plugins page declares the `plugins.row.config` slot; this module
 * registers the row's page with the three answers a fresh standalone install
 * needs. The host half already reads the same keys from its Config schema; the
 * patch keeps the environment as the fallback, and a value saved here is the
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
    const inputStyle = {
      boxSizing: 'border-box',
      width: '100%',
      padding: '6px 8px',
      borderRadius: 6,
      border: '1px solid var(--dsh-border, #d0d5dd)',
      background: 'var(--dsh-surface, #fff)',
      color: 'inherit',
      font: 'inherit',
    }

    function field(label, hint, input) {
      return h(
        'label',
        { style: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 } },
        h('span', { style: { fontWeight: 600 } }, label),
        hint === undefined ? null : h('span', { style: { opacity: 0.7, fontSize: 12 } }, hint),
        input,
      )
    }

    function parseIds(text) {
      return text
        .split(/[\s,]+/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .map((part) => Number(part))
        .filter((id) => Number.isFinite(id) && id > 0)
    }

    function TelegramConfigForm({ form }) {
      if (form === undefined) {
        return h('p', null, 'This plugin does not expose its configuration in this build.')
      }
      const state = form.state
      if (state.status === 'unavailable') {
        return h('p', null, 'This plugin is not loaded, so it cannot be configured right now.')
      }
      if (state.status === 'loading') {
        return h('p', null, 'Loading the current values…')
      }
      const value = state.value ?? {}
      const [botToken, setBotToken] = React.useState(String(value.botToken ?? ''))
      const [allowed, setAllowed] = React.useState(Array.isArray(value.allowedUserIds) ? value.allowedUserIds.join(', ') : '')
      const [admin, setAdmin] = React.useState(value.adminUserId === undefined ? '' : String(value.adminUserId))
      const [saving, setSaving] = React.useState(false)
      const [message, setMessage] = React.useState('')

      React.useEffect(() => {
        const next = state.value ?? {}
        setBotToken(String(next.botToken ?? ''))
        setAllowed(Array.isArray(next.allowedUserIds) ? next.allowedUserIds.join(', ') : '')
        setAdmin(next.adminUserId === undefined ? '' : String(next.adminUserId))
      }, [state.revision])

      const disabled = !state.writable || saving
      const save = async () => {
        const ids = parseIds(allowed)
        const adminId = admin.trim().length === 0 ? undefined : Number(admin.trim())
        if (adminId !== undefined && (!Number.isFinite(adminId) || adminId <= 0)) {
          setMessage('The admin user id must be a number, or empty to use the first allowed id.')
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
          setMessage(ok ? 'Saved. The connector reconnects with these values.' : 'The deployment did not accept these values; they were left for you to correct.')
        } catch (error) {
          setMessage(`Save failed: ${String(error)}`)
        } finally {
          setSaving(false)
        }
      }

      return h(
        'div',
        null,
        h('p', null, 'Connect the bot to Telegram. The token comes from @BotFather; user ids are numeric and come from @userinfobot.'),
        field(
          'Bot token',
          'For example 123456789:AA… . Keep it out of screenshots and commits.',
          h('input', {
            type: 'password',
            value: botToken,
            disabled,
            placeholder: 'the token from @BotFather',
            style: inputStyle,
            onChange: (event) => setBotToken(event.target.value),
          }),
        ),
        field(
          'Allowed user ids',
          'Comma- or space-separated numeric ids. Everyone in this list can talk to the agent and use the sessions.',
          h('input', {
            type: 'text',
            value: allowed,
            disabled,
            placeholder: '142283532, 777000111',
            style: inputStyle,
            onChange: (event) => setAllowed(event.target.value),
          }),
        ),
        field(
          'Admin user id',
          'Optional. One allowed id that may update, restart, roll back and manage plugins; empty uses the first allowed id.',
          h('input', {
            type: 'text',
            value: admin,
            disabled,
            placeholder: 'optional',
            style: inputStyle,
            onChange: (event) => setAdmin(event.target.value),
          }),
        ),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 10 } },
          h(
            'button',
            {
              type: 'button',
              disabled,
              onClick: save,
              style: { padding: '6px 14px', borderRadius: 6, cursor: disabled ? 'default' : 'pointer' },
            },
            saving ? 'Saving…' : 'Save',
          ),
          message.length === 0 ? null : h('span', { style: { fontSize: 13 } }, message),
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
