// LWB Bridge — Based on LittleWhiteBox by biex (LittleWhiteBox / 小白X).
// Original: https://github.com/RT15548/LittleWhiteBox ; derivative terms: LICENSE.md.
// dsh-tavern-lwb 0.1.0-beta.53 — native Tavern Web UI, public API 7/8.
// This client only requests explicit host actions; it never evaluates state text.
window.__ModuleLoader__.load({
  id: 'dsh-tavern-lwb',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NAME = 'dsh-tavern-lwb'
    const VERSION = '0.1.0-beta.53'
    const SAMPLE = '<state>\n$schema 数据\n  角色:\n    生命值: 0\n    金币: 0\n\n数据:\n  角色:\n    生命值: 100\n    金币: 0\n</state>'
    const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key)
    const json = value => {
      try { return JSON.stringify(value, null, 2) || 'null' } catch (_) { return '数据无法显示为 JSON。' }
    }
    const errorText = error => {
      if (error && error.code === 'TAVERN_PLUGIN_NOT_FOUND') return '宿主处理器尚未加载，请检查插件宿主端。'
      return error && typeof error.message === 'string' ? error.message : String(error || '操作失败')
    }
    const identity = value => value ? String(value.turn) + ':' + String(value.textVersion) : ''
    const styles = {
      viewport: { height: '100%', minHeight: 0, flex: 1, overflowY: 'auto', boxSizing: 'border-box', minWidth: 0 },
      stack: { display: 'flex', flexDirection: 'column', gap: 12, flexShrink: 0, minWidth: 0, padding: '12px 12px calc(88px + env(safe-area-inset-bottom, 0px))', boxSizing: 'border-box', font: 'inherit', color: 'inherit', overflowWrap: 'anywhere' },
      panel: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, flexShrink: 0, font: 'inherit', color: 'inherit', overflowWrap: 'anywhere' },
      box: { border: '1px solid var(--dsh-border-color, var(--gal-ui-line, rgba(128,128,128,.3)))', borderRadius: 'var(--gal-ui-radius, 8px)', padding: 12, minWidth: 0 },
      row: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
      button: { font: 'inherit', color: 'inherit', background: 'var(--gal-ui-surface-2, transparent)', border: '1px solid var(--gal-ui-line, rgba(128,128,128,.45))', borderRadius: 6, padding: '8px 10px', minHeight: 44, maxWidth: '100%', whiteSpace: 'normal', cursor: 'pointer' },
      pre: { margin: '8px 0 0', padding: 10, fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word', maxHeight: '45vh', overflow: 'auto', background: 'var(--gal-ui-surface-2, rgba(128,128,128,.08))', borderRadius: 6 },
      muted: { margin: 0, fontSize: 12, lineHeight: 1.6, opacity: .75 },
      textarea: { display: 'block', width: '100%', boxSizing: 'border-box', minHeight: 190, resize: 'vertical', fontFamily: 'monospace', fontSize: 14, lineHeight: 1.5, color: 'inherit', background: 'var(--gal-ui-surface, transparent)', border: '1px solid var(--gal-ui-line, rgba(128,128,128,.45))', borderRadius: 6, padding: 10 },
      heading: { fontSize: '1em', margin: '0 0 8px', fontWeight: 600 },
    }

    function Diagnostics({ value, title }) {
      if (!value) return null
      return h('details', { style: styles.box },
        h('summary', null, title || '诊断'),
        h('p', { style: styles.muted }, '状态：' + String(value.status || '未提供')),
        ['errors', 'corrections', 'changes'].map(key => h('div', { key },
          h('strong', { style: { fontSize: 12 } }, { errors: '错误', corrections: '修正', changes: '变更' }[key]),
          h('pre', { style: styles.pre }, json(value[key] == null ? [] : value[key])))))
    }

    function MigrationPanel({ ui, gameId, snapshot, onSaved }) {
      const [text, setText] = React.useState('')
      const [from, setFrom] = React.useState('2'), [to, setTo] = React.useState('2')
      const [initial, setInitial] = React.useState(SAMPLE)
      const [preview, setPreview] = React.useState(null), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('')
      const epoch = React.useRef(0)
      React.useEffect(() => { epoch.current++; setPreview(null); return () => { epoch.current++ } }, [gameId, snapshot?.turn, snapshot?.textVersion, snapshot?.record?.stateHash, snapshot?.enabled, snapshot?.busy])
      const allowed = !!snapshot?.enabled && !snapshot?.busy && !busy
      async function act(mode) {
        if (!allowed) return
        const ticket = ++epoch.current; setBusy(true); setError(''); setPreview(null)
        try {
          const value = mode === 'inspect' ? { inspection: await ui.callHost(NAME + '/compat/varevent-inspect', { gameId, text }) }
            : mode === 'static' ? { inspection: await ui.callHost(NAME + '/compat/varevent-static-preview', { gameId, text }) }
            : await ui.callHost(NAME + '/migration-preview', { gameId, expectedTextVersion: snapshot.textVersion, mode, text, initialText: initial, from: Number(from), to: Number(to) })
          if (ticket === epoch.current) setPreview(value)
        } catch (e) { if (ticket === epoch.current) setError(errorText(e)) }
        finally { setBusy(false) }
      }
      async function commit() {
        if (!allowed || !preview || !window.confirm('确认以预览状态替换当前轮状态并建立新基线？历史轮不改写，较晚旧快照可能失效。请先导出备份。')) return
        const ticket = ++epoch.current; setBusy(true); setError('')
        try {
          await ui.callHost(NAME + '/migration-commit', { gameId, token: preview.token, expectedTextVersion: snapshot.textVersion, confirmReplace: true })
          if (ticket === epoch.current) { setPreview(null); onSaved() }
        } catch (e) { if (ticket === epoch.current) { setError(errorText(e)); setPreview(null) } }
        finally { setBusy(false) }
      }
      const edit = setter => event => { epoch.current++; setPreview(null); setter(event.target.value) }
      return h('details', { style: styles.box }, h('summary', null, '状态恢复与历史回放'),
        h('p', { style: styles.muted }, '先导出备份。支持Bridge状态导出包；回放严格处理已完成正文的state块，失败整批停止；确认后只建立当前轮新基线，不改写旧轮。'),
        error ? h('p', { role: 'alert' }, error) : null,
        h('label', null, '状态备份JSON', h('textarea', { value: text, onChange: edit(setText), disabled: busy, style: styles.textarea, 'aria-label': '状态备份JSON' })),
        h('button', { onClick: () => act('backup'), disabled: !allowed || !text.trim(), style: styles.button }, '预览恢复状态'),
        h('button', { onClick: () => act('inspect'), disabled: !allowed || !text.trim(), style: styles.button }, '只读检查varevent（不执行）'),
        h('button', { onClick: () => act('static'), disabled: !allowed || !text.trim(), style: styles.button }, '预览无条件事件显示（不执行）'),
        h('label', null, '回放初始化文本', h('textarea', { value: initial, onChange: edit(setInitial), disabled: busy, style: styles.textarea, 'aria-label': '回放初始化文本' })),
        h('div', { style: styles.row }, h('label', null, '回放起始轮', h('input', { type: 'number', value: from, onChange: edit(setFrom), disabled: busy })), h('label', null, '回放结束轮', h('input', { type: 'number', value: to, onChange: edit(setTo), disabled: busy }))),
        h('button', { onClick: () => act('history'), disabled: !allowed, style: styles.button }, '预览历史回放'),
        preview ? h('div', null, h('pre', { style: styles.pre }, json(preview)), preview.token ? h('button', { onClick: commit, disabled: !allowed, style: styles.button }, '确认建立迁移基线') : null) : null)
    }

    function StatePanel({ ui, gameId }) {
      const [snapshot, setSnapshot] = React.useState(null)
      const [turnState, setTurnState] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [pending, setPending] = React.useState('')
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [watchErrors, setWatchErrors] = React.useState([])
      const [text, setText] = React.useState(SAMPLE)
      const [preview, setPreview] = React.useState(null)
      const generation = React.useRef(0)
      const session = React.useRef(null)
      const input = React.useRef(SAMPLE)
      const previewRef = React.useRef(null)

      const invalidatePreview = React.useCallback(() => {
        previewRef.current = null
        setPreview(null)
      }, [])

      React.useEffect(() => {
        const epoch = ++generation.current
        const state = { gameId, epoch, dead: false, dirty: false, reading: false, mutating: false, revision: 0, data: null, turn: null, readError: '', stops: [], urls: new Map() }
        session.current = state
        const active = () => !state.dead && generation.current === epoch && session.current === state
        state.active = active
        state.cancelPreview = () => { if (active()) invalidatePreview() }
        setSnapshot(null)
        setTurnState(null)
        setLoading(true)
        setPending('')
        setError('')
        setNotice('')
        setWatchErrors([])
        invalidatePreview()
        input.current = SAMPLE
        setText(SAMPLE)

        async function pump() {
          if (!active() || state.reading || state.mutating) return
          state.reading = true
          try {
            while (active() && state.dirty && !state.mutating) {
              state.dirty = false
              const request = state.revision
              try {
                const data = await ui.callHost(NAME + '/read', { gameId })
                if (!active() || request !== state.revision || state.mutating) continue
                if (!data || typeof data.enabled !== 'boolean' || typeof data.busy !== 'boolean') throw new Error('宿主返回了无效的状态快照。')
                const previous = state.data
                state.data = data
                if (previewRef.current && (identity(data) !== identity(previewRef.current) || data.initializable !== true || data.busy || !data.enabled || (previous && previous.record !== null && json(previous.record) !== json(data.record)))) state.cancelPreview()
                setSnapshot(data)
                if (state.readError) {
                  const recovered = state.readError
                  state.readError = ''
                  setError(current => current === recovered ? '' : current)
                }
              } catch (failure) {
                if (active() && request === state.revision && !state.mutating) {
                  state.data = null
                  setSnapshot(null)
                  state.cancelPreview()
                  state.readError = errorText(failure)
                  setError(state.readError)
                }
              }
            }
          } finally {
            state.reading = false
            if (active()) {
              setLoading(false)
              if (state.dirty && !state.mutating) void pump()
            }
          }
        }
        state.refresh = () => {
          if (!active()) return
          ++state.revision
          state.dirty = true
          void pump()
        }
        if (typeof gameId !== 'string' || !gameId) {
          setLoading(false)
          setError('请先打开一局游戏。')
        } else {
          const subscribe = (label, register) => {
            try {
              const stop = register()
              if (typeof stop === 'function') state.stops.push(stop)
            } catch (failure) {
              if (active()) setWatchErrors(list => list.concat(label + '：' + errorText(failure)))
            }
          }
          subscribe('回合订阅不可用', () => ui.watchTurnState(gameId, value => {
            if (!active()) return
            const before = state.turn
            state.turn = value
            if (!before || !value || identity(before) !== identity(value) || value.busy || value.settled !== true) state.cancelPreview()
            setTurnState(value)
            state.refresh()
          }))
          subscribe('状态订阅不可用', () => ui.watchState(gameId, 'state', () => {
            if (!active()) return
            // A published state may replace data without changing the text version.
            state.cancelPreview()
            state.refresh()
          }))
          state.refresh()
        }
        return () => {
          state.dead = true
          ++state.revision
          if (generation.current === epoch) ++generation.current
          state.stops.forEach(stop => { try { stop() } catch (_) {} })
          state.urls.forEach((timer, url) => { clearTimeout(timer); try { URL.revokeObjectURL(url) } catch (_) {} })
          state.urls.clear()
          if (session.current === state) session.current = null
        }
      }, [ui, gameId, invalidatePreview])

      function settled(state, data) {
        return !!(state.turn && state.turn.settled === true && !state.turn.busy && data && !data.busy && identity(state.turn) === identity(data) && typeof data.textVersion === 'string')
      }
      function canInitialize(state, data) {
        return !!(data && data.enabled && data.initializable === true && settled(state, data))
      }
      function validPreview(state, data, value) {
        return !!(value && value.allowed && value.text === input.current && identity(value) === identity(data) && canInitialize(state, data))
      }
      async function run(label, action) {
        const state = session.current
        if (!state || !state.active() || state.mutating || state.reading || !state.data || state.data.busy || (state.turn && state.turn.busy)) return
        state.mutating = true
        ++state.revision // Ignore any read started before this explicit action.
        setPending(label)
        setError('')
        setNotice('')
        try { await action(state, state.data) }
        catch (failure) {
          if (state.active()) {
            state.cancelPreview()
            setError(errorText(failure))
          }
        } finally {
          state.mutating = false
          if (state.active()) {
            setPending('')
            state.refresh()
          }
        }
      }
      function changeInput(next) {
        input.current = next
        setText(next)
        invalidatePreview()
      }
      function toggleEnabled() {
        void run('设置开关', async (state, data) => {
          state.cancelPreview()
          await ui.callHost(NAME + '/enable', { gameId: state.gameId, enabled: !data.enabled })
          if (state.active()) setNotice(data.enabled ? '已关闭本局。' : '已开启本局。已有回复请主动点击“处理当前回复”。')
        })
      }
      function requestPreview() {
        void run('预览', async (state, data) => {
          if (!canInitialize(state, data) || !input.current.trim()) return
          const submitted = input.current
          const request = state.revision
          state.cancelPreview()
          const result = await ui.callHost(NAME + '/preview', { gameId: state.gameId, text: submitted, expectedTextVersion: data.textVersion })
          if (!state.active() || request !== state.revision || input.current !== submitted || !canInitialize(state, state.data) || identity(data) !== identity(state.data)) return
          if (!result || typeof result.status !== 'string' || !Array.isArray(result.errors)) throw new Error('宿主返回了无效的预览结果。')
          const value = { result, text: submitted, textVersion: data.textVersion, turn: data.turn, allowed: result.status === 'success' && result.errors.length === 0 && Array.isArray(result.engine?.roots) && result.engine.roots.length > 0 && Object.keys(result.engine?.variables || {}).length > 0 }
          previewRef.current = value
          setPreview(value)
        })
      }
      function initialize() {
        void run('初始化', async (state, data) => {
          const selected = previewRef.current
          if (!validPreview(state, data, selected)) { state.cancelPreview(); throw new Error('预览已过期，请重新预览。') }
          // Re-read immediately before the write; the host also enforces the version.
          const fresh = await ui.callHost(NAME + '/read', { gameId: state.gameId })
          if (!state.active()) return
          if (previewRef.current !== selected || !validPreview(state, fresh, selected)) { state.cancelPreview(); throw new Error('本局状态或正文版本已变化，请刷新并重新预览。') }
          state.cancelPreview()
          await ui.callHost(NAME + '/initialize', { gameId: state.gameId, text: selected.text, expectedTextVersion: selected.textVersion })
          if (state.active()) setNotice('初始化已提交，正在读取本局状态。')
        })
      }
      function processCurrent() {
        void run('处理当前回复', async (state, data) => {
          if (!data.enabled || !settled(state, data)) return
          state.cancelPreview()
          await ui.callHost(NAME + '/process', { gameId: state.gameId, expectedTextVersion: data.textVersion })
          if (state.active()) setNotice('当前回复已交由宿主处理，请查看状态和诊断。')
        })
      }
      function exportState() {
        void run('导出', async state => {
          const result = await ui.callHost(NAME + '/export', { gameId: state.gameId })
          if (!state.active()) return
          if (!result || typeof result.text !== 'string') throw new Error('宿主未返回有效的 JSON 导出文本。')
          JSON.parse(result.text)
          if (typeof Blob !== 'function' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function' || typeof document === 'undefined') throw new Error('当前浏览器不支持文件下载。')
          const url = URL.createObjectURL(new Blob([result.text], { type: 'application/json;charset=utf-8' }))
          let anchor
          try {
            anchor = document.createElement('a')
            anchor.href = url
            anchor.download = 'dsh-tavern-lwb-state.json'
            anchor.style.display = 'none'
            document.body.appendChild(anchor)
            anchor.click()
            const timer = setTimeout(() => { URL.revokeObjectURL(url); state.urls.delete(url) }, 1000)
            state.urls.set(url, timer)
          } catch (failure) {
            URL.revokeObjectURL(url)
            throw failure
          } finally { if (anchor && anchor.parentNode) anchor.parentNode.removeChild(anchor) }
          if (state.active()) setNotice('已请求浏览器下载 dsh-tavern-lwb-state.json。')
        })
      }

      const state = session.current
      const busy = !!(loading || pending || !snapshot || snapshot.busy || (turnState && turnState.busy))
      const ready = !!(state && canInitialize(state, snapshot))
      const confirmed = !!(state && validPreview(state, snapshot, preview))
      const record = snapshot && snapshot.record
      const variables = record && record.engine && own(record.engine, 'variables') ? record.engine.variables : null
      const button = (label, onClick, disabled) => h('button', { type: 'button', style: styles.button, onClick, disabled: !!disabled }, label)
      return h('section', { style: styles.panel, 'aria-label': '小白状态', 'aria-busy': !!pending || loading },
        h('div', null,
          h('h2', { style: styles.heading }, '小白状态'),
          h('p', { style: styles.muted }, VERSION + ' · Tavern API 7 验证版')),
        h('p', { style: styles.muted }, '仅解释受支持的 <state> 状态语法，不运行脚本。样例只合成角色生命值与金币；不会向模型发请求或自动发送消息。'),
        h('div', { style: styles.box },
          h('div', { style: styles.row },
            h('strong', null, snapshot ? (snapshot.enabled ? '本局已开启' : '本局未开启') : '读取本局状态'),
            snapshot ? h('span', null, '第 ' + String(snapshot.turn) + ' 轮 · ' + (snapshot.busy || (turnState && turnState.busy) ? '忙碌中' : (turnState && turnState.settled ? '已结算' : '等待结算'))) : null),
          h('div', { style: Object.assign({}, styles.row, { marginTop: 8 }) },
            button(snapshot && snapshot.enabled ? '关闭本局' : '开启本局', toggleEnabled, busy),
            button('刷新', () => { const current = session.current; if (current && current.active() && !current.mutating) current.refresh() }, !!pending || loading),
            button('导出 JSON', exportState, busy || !record)),
          h('p', { style: styles.muted }, '开关只作用于当前游戏；首次开启不补跑历史。')),
        error ? h('p', { role: 'alert', style: styles.box }, error) : null,
        notice ? h('p', { role: 'status', style: styles.box }, notice) : null,
        watchErrors.length ? h('p', { role: 'status', style: styles.muted }, watchErrors.join('；') + '。可使用“刷新”重新读取。') : null,
        pending ? h('p', { role: 'status', style: styles.muted }, '正在' + pending + '…') : null,
        h('div', { style: styles.box },
          h('h3', { style: styles.heading }, '当前变量（只读 JSON）'),
          record ? h('pre', { style: styles.pre }, json(variables)) : h('p', { style: styles.muted }, '暂无状态记录。'),
          record ? h('p', { style: styles.muted }, '来源：' + String(record.sourceKind || '未知')) : null),
        snapshot && snapshot.warning ? h('p', { role: 'alert', style: styles.box }, snapshot.warning.message + ' 当前展示的是供导出检查的失效快照，不会继续注入模型。') : null,
        record ? h(Diagnostics, { value: record.diagnostics, title: '当前记录诊断' }) : null,
        h('div', { style: styles.box },
          h('h3', { style: styles.heading }, '初始化空状态'),
          h('p', { style: styles.muted }, '仅本局初始空状态且当前轮已结算时可用。先预览，检查诊断后再确认；修改输入、切换正文版本或状态变化后需重新预览。'),
          h('label', null, '初始化状态文本', h('textarea', { style: styles.textarea, value: text, onChange: event => changeInput(event.target.value), disabled: !!pending, spellCheck: false, 'aria-label': '初始化状态文本' })),
          h('div', { style: Object.assign({}, styles.row, { marginTop: 8 }) },
            button('填入生命值＋金币样例', () => changeInput(SAMPLE), !!pending),
            button('预览', requestPreview, busy || !ready || !text.trim()),
            button('确认初始化', initialize, busy || !confirmed)),
          !ready ? h('p', { style: styles.muted }, '需先开启本局，等当前轮结算，且宿主确认可初始化。') : null,
          preview ? h('div', { role: 'status' },
            h('p', { style: styles.muted }, '预览：' + String(preview.result.status) + ' · 操作数：' + String(preview.result.operationCount == null ? '未提供' : preview.result.operationCount) + (preview.allowed ? ' · 可确认初始化' : ' · 请根据诊断修改后重新预览')),
            h(Diagnostics, { value: preview.result, title: '预览诊断（尚未写入）' })) : null),
        h('div', { style: styles.box },
          h('h3', { style: styles.heading }, '手动处理已有回复'),
          h('p', { style: styles.muted }, '用于安装或开启插件前，当前回复已经存在的 <state> 块。仅处理当前已结算的正文版本，由你主动触发。'),
          button('处理当前回复', processCurrent, busy || !snapshot || !snapshot.enabled || !state || !settled(state, snapshot))),
        h(MigrationPanel, { key: gameId, ui, gameId, snapshot, onSaved: () => session.current?.refresh() }),
        h('details', { style: styles.box },
          h('summary', null, '验证版支持边界与宿主限制'),
          h('p', { style: styles.muted }, '本面板只显示 record.engine.variables；状态解析、规则检查、去重及版本写入由配套宿主负责。仅支持宿主已实现的 State2 子集；不执行 taskjs、JavaScript、旧版 plot-log 或旧酒馆脚本 API。受控State2历史可用上面的迁移面板预览；完整WAL、swipe和旧脚本迁移尚不支持。'),
          h('p', { style: styles.muted }, '宿主版本：' + String(snapshot && snapshot.version || '未连接')),
          snapshot && snapshot.limits ? h('pre', { style: styles.pre }, json(snapshot.limits)) : null))
    }

    function MemoryPanel({ ui, gameId }) {
      const [snapshot, setSnapshot] = React.useState(null)
      const [turnState, setTurnState] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [pending, setPending] = React.useState('')
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [text, setText] = React.useState('')
      const [preview, setPreview] = React.useState(null)
      const [template, setTemplate] = React.useState('')
      const [from, setFrom] = React.useState('1')
      const [to, setTo] = React.useState('1')
      const [choiceState, setChoiceState] = React.useState({ scope: '', values: {} })
      const choiceScope = gameId + ':' + (snapshot?.pendingSummary?.token || '')
      const mergeChoices = choiceState.scope === choiceScope ? choiceState.values : {}
      const generation = React.useRef(0)
      const session = React.useRef(null)
      const input = React.useRef('')
      const previewRef = React.useRef(null)
      const clearPreview = React.useCallback(() => { previewRef.current = null; setPreview(null) }, [])

      React.useEffect(() => {
        const epoch = ++generation.current
        const state = { gameId, dead: false, revision: 0, file: 0, reading: false, dirty: false, mutating: false, data: null, turn: null, stops: [], urls: new Map() }
        session.current = state
        state.active = () => !state.dead && generation.current === epoch && session.current === state
        state.invalidate = () => { ++state.file; clearPreview() }
        setSnapshot(null); setTurnState(null); setLoading(true); setPending(''); setError(''); setNotice('')
        input.current = ''; setText(''); setTemplate(''); setFrom('1'); setTo('1'); clearPreview()
        async function pump() {
          if (!state.active() || state.reading || state.mutating) return
          state.reading = true; setLoading(true)
          try {
            while (state.active() && state.dirty && !state.mutating) {
              state.dirty = false
              const request = state.revision
              try {
                const data = await ui.callHost(NAME + '/memory/read', { gameId })
                if (!state.active() || request !== state.revision || state.mutating) continue
                if (!data || typeof data.busy !== 'boolean' || typeof data.textVersion !== 'string' || typeof data.settings?.enabled !== 'boolean' || typeof data.settings?.macroTemplate !== 'string') throw new Error('宿主返回了无效的记忆快照。')
                if (state.turn && identity(state.turn) !== identity(data)) { state.data = null; setSnapshot(null); state.invalidate(); continue }
                const before = state.data
                if (before && (identity(before) !== identity(data) || json(before.record) !== json(data.record))) state.invalidate()
                if (data.busy) state.invalidate()
                state.data = data
                setSnapshot(data)
                if (!before || before.settings.macroTemplate !== data.settings.macroTemplate) setTemplate(data.settings.macroTemplate)
                if (state.readError) { const recovered = state.readError; state.readError = ''; setError(value => value === recovered ? '' : value) }
              } catch (failure) {
                if (state.active() && request === state.revision) { state.data = null; setSnapshot(null); state.invalidate(); state.readError = errorText(failure); setError(state.readError) }
              }
            }
          } finally {
            state.reading = false
            if (state.active()) { setLoading(false); if (state.dirty && !state.mutating) void pump() }
          }
        }
        state.refresh = () => { if (state.active()) { ++state.revision; state.dirty = true; void pump() } }
        if (typeof gameId !== 'string' || !gameId) { setLoading(false); setError('请先打开一局游戏。') }
        else {
          const subscribe = register => {
            try { const stop = register(); if (typeof stop === 'function') state.stops.push(stop) }
            catch (failure) { if (state.active()) setNotice('订阅不可用，可手动刷新：' + errorText(failure)) }
          }
          subscribe(() => ui.watchTurnState(gameId, value => {
            if (!state.active()) return
            if (!state.turn || !value || identity(state.turn) !== identity(value) || value.busy || value.settled !== true) state.invalidate()
            state.turn = value; setTurnState(value); state.refresh()
          }))
          subscribe(() => ui.watchState(gameId, 'memory', () => { if (state.active()) { state.invalidate(); state.refresh() } }))
          state.refresh()
        }
        return () => {
          state.dead = true; ++state.revision; ++state.file
          if (generation.current === epoch) ++generation.current
          state.stops.forEach(stop => { try { stop() } catch (_) {} })
          state.urls.forEach((timer, url) => { clearTimeout(timer); try { URL.revokeObjectURL(url) } catch (_) {} }); state.urls.clear()
          if (session.current === state) session.current = null
        }
      }, [ui, gameId, clearPreview])

      function ready(state, data) {
        return !!(state && data && !data.busy && typeof data.textVersion === 'string' && state.turn?.settled === true && !state.turn.busy && identity(state.turn) === identity(data))
      }
      function current(state, data, request) {
        return state.active() && request === state.revision && ready(state, state.data) && identity(data) === identity(state.data)
      }
      async function run(label, action) {
        const state = session.current
        if (!state?.active() || state.mutating || state.reading || !ready(state, state.data)) return
        state.mutating = true; ++state.revision; setPending(label); setError(''); setNotice('')
        try { await action(state, state.data, state.revision) }
        catch (failure) { if (state.active()) { state.invalidate(); setError(errorText(failure)) } }
        finally { state.mutating = false; if (state.active()) { setPending(''); state.refresh() } }
      }
      function changeInput(value) {
        if (session.current) session.current.invalidate()
        input.current = value; setText(value)
      }
      async function selectFile(event) {
        const file = event.target.files && event.target.files[0]
        event.target.value = ''
        const state = session.current
        if (!state?.active() || state.mutating || state.reading || !ready(state, state.data)) return
        state.invalidate(); setError('')
        if (!file) return
        if (file.size > 49152) { setError('JSON 文件不能超过 49152 字节。'); return }
        const request = state.file, version = identity(state.data)
        try {
          const value = typeof file.text === 'function' ? await file.text() : await new Promise((resolve, reject) => {
            const reader = new window.FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('无法读取文件。')); reader.readAsText(file)
          })
          if (!state.active() || request !== state.file || version !== identity(state.data) || !ready(state, state.data)) return
          input.current = String(value); setText(String(value)); clearPreview()
        } catch (failure) { if (state.active() && request === state.file) setError(errorText(failure)) }
      }
      function requestPreview() {
        void run('预览记忆', async (state, data, request) => {
          const submitted = input.current
          state.invalidate()
          const fileRequest = state.file
          const result = await ui.callHost(NAME + '/memory/preview', { gameId, text: submitted, expectedTextVersion: data.textVersion })
          if (!current(state, data, request) || fileRequest !== state.file || submitted !== input.current) return
          if (!result || typeof result.token !== 'string' || !result.token || !own(result, 'data')) throw new Error('宿主未返回有效的记忆预览。')
          const value = { ...result, text: submitted, textVersion: data.textVersion, turn: data.turn }
          previewRef.current = value; setPreview(value)
        })
      }
      function importMemory() {
        const selected = previewRef.current
        if (!selected || !window.confirm('确认用已预览的 JSON 替换本局记忆？此操作会覆盖当前记忆。')) return
        void run('替换记忆', async (state, data) => {
          if (selected !== previewRef.current || selected.text !== input.current || identity(selected) !== identity(data)) throw new Error('预览已过期，请重新预览。')
          state.invalidate()
          await ui.callHost(NAME + '/memory/import', { gameId, token: selected.token, expectedTextVersion: data.textVersion })
          if (state.active()) setNotice('已提交替换记忆。')
        })
      }
      function settings(patch) {
        void run('保存记忆设置', async (state, data) => {
          await ui.callHost(NAME + '/memory/settings', { gameId, ...patch, expectedTextVersion: data.textVersion })
          if (state.active()) setNotice('记忆设置已保存。')
        })
      }
      function exportMemory() {
        void run('导出记忆', async state => {
          const result = await ui.callHost(NAME + '/memory/export', { gameId })
          if (!state.active()) return
          if (!result || typeof result.text !== 'string' || typeof result.fileName !== 'string') throw new Error('宿主未返回有效的记忆导出。')
          JSON.parse(result.text)
          if (typeof Blob !== 'function' || typeof URL.createObjectURL !== 'function') throw new Error('当前浏览器不支持文件下载。')
          const url = URL.createObjectURL(new Blob([result.text], { type: 'application/json;charset=utf-8' }))
          let anchor
          try {
            anchor = document.createElement('a'); anchor.href = url
            anchor.download = result.fileName.replace(/[\/\\\u0000-\u001f\u007f]/g, '_').slice(0, 160) || 'dsh-tavern-lwb-memory.json'
            anchor.style.display = 'none'; document.body.appendChild(anchor); anchor.click()
            const timer = setTimeout(() => { URL.revokeObjectURL(url); state.urls.delete(url) }, 1000); state.urls.set(url, timer)
          } catch (failure) { URL.revokeObjectURL(url); throw failure }
          finally { if (anchor?.parentNode) anchor.parentNode.removeChild(anchor) }
          if (state.active()) setNotice('已请求浏览器下载记忆 JSON。')
        })
      }
      function summaryMessage(value, candidate) {
        const status = value?.status
        const labels = {
          queued: '等待生成：请求已排队，请等待状态更新。',
          running: '正在生成：请等待完成，无需反复点击。',
          ready: candidate ? '候选已生成，请在下方查看、采用或丢弃。' : '候选已生成；正在等待候选数据，请刷新记忆。',
          failed: '生成失败。' + (!candidate ? '不需要反复点击；本次未替换记忆。新的生成仍需确认模型额度。' : '本次未替换记忆。'),
          cancelled: '生成已取消，本次未替换记忆。',
          expired: '候选已过期，已不再提供待采用候选；本次未替换记忆。',
          stale: '候选对应的回合或正文版本已变化，已失效且不再提供；本次未替换记忆。',
          adopted: '候选已采用，当前已无待采用候选。',
          discarded: '候选已丢弃，当前已无待采用候选；本次未替换记忆。',
        }
        const label = (own(labels, status) && labels[status]) || (candidate ? '候选在下方，可查看、采用或丢弃。' : '尚未生成记忆候选')
        return label + (typeof value?.message === 'string' && value.message ? ' ' + value.message : '') + (typeof value?.code === 'string' && value.code ? ' [' + value.code + ']' : '')
      }
      function startSummary() {
        const state = session.current, start = Number(from), end = Number(to)
        if (!state?.active() || state.mutating || state.reading || !ready(state, state.data) || state.data.pendingSummary || ['queued', 'running'].includes(state.data.summaryStatus?.status)) return
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end - start + 1 > 20 || end > state.data.turn) { setError('请选择有效的已完成轮次，每次最多 20 轮。'); return }
        if (!window.confirm('生成候选将使用本局后台模型额度，可能产生费用。宿主可能附带人物卡、世界书和最近剧情。确认开始？')) return
        const confirmationId = typeof window.crypto?.randomUUID === 'function' ? window.crypto.randomUUID() : Array.from(window.crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('')
        void run('生成候选', async (state, data) => {
          state.invalidate()
          const result = await ui.callHost(NAME + '/memory/summary-start', { gameId, from: start, to: end, expectedTextVersion: data.textVersion, confirmModelUse: true, confirmationId })
          if (!state.active()) return
          if (result?.status === 'already-admitted' || result?.code === 'already-admitted') setNotice('本次已接纳，正在刷新总结状态；不会再次发送生成请求。')
          else if (result?.summaryStatus || typeof result?.status === 'string') setNotice(summaryMessage(result.summaryStatus || result, null))
          else setNotice('正在刷新总结状态；查看候选后可采用或丢弃。')
        })
      }
      function commitSummary() {
        const selected = session.current?.data?.pendingSummary
        if (!selected || !window.confirm('确认采用已选增量？未选择的潜在冲突会保留旧记忆。')) return
        void run('采用增量记忆', async (state, data) => {
          if (data.pendingSummary !== selected || identity(selected) !== identity(data)) throw new Error('候选已过期，请刷新。')
          state.invalidate()
          await ui.callHost(NAME + '/memory/summary-commit', { gameId, token: selected.token, expectedTextVersion: data.textVersion, choices: mergeChoices })
          if (state.active()) setNotice('已提交增量记忆。')
        })
      }
      function mergeChoice(id, value) {
        setChoiceState(previous => ({ scope: choiceScope, values: { ...(previous.scope === choiceScope ? previous.values : {}), [id]: value } }))
      }
      function discardSummary() {
        void run('丢弃候选', async (state, data) => {
          await ui.callHost(NAME + '/memory/summary-discard', { gameId, ...(data.pendingSummary ? { token: data.pendingSummary.token } : {}) })
          if (state.active()) setNotice('已丢弃候选。')
        })
      }
      const state = session.current
      const busy = !!(loading || pending || !ready(state, snapshot))
      const candidate = snapshot?.pendingSummary
      const merge = candidate?.merge
      const valid = !!(preview && preview === previewRef.current && preview.text === text && identity(preview) === identity(snapshot))
      const button = (label, onClick, disabled = busy) => h('button', { type: 'button', style: styles.button, onClick, disabled: !!disabled }, label)
      const details = (title, value) => h('details', { style: styles.box }, h('summary', null, title), h('pre', { style: styles.pre }, json(value)))
      return h('section', { style: styles.panel, 'aria-label': '小白记忆', 'aria-busy': loading || !!pending },
        h('h2', { style: styles.heading }, '小白记忆'),
        h('p', { style: styles.muted }, '仅手动导入、导出和生成候选，不会自动总结或发送消息。'),
        error ? h('p', { role: 'alert' }, error) : null,
        notice ? h('p', { role: 'status' }, notice) : null,
        pending ? h('p', { role: 'status' }, '正在' + pending + '…') : null,
        h('div', { style: styles.box },
          h('p', null, snapshot ? '第 ' + String(snapshot.turn) + ' 轮 · ' + (snapshot.busy || turnState?.busy ? '忙碌中' : '记忆已读取') : '读取本局记忆'),
          h('div', { style: styles.row },
            button('刷新记忆', () => { if (state?.active() && !state.mutating && !state.reading) state.refresh() }, !!pending || loading || !!state?.mutating),
            button(snapshot?.settings.enabled ? '关闭记忆' : '开启记忆', () => settings({ enabled: !snapshot.settings.enabled })),
            button('导出记忆 JSON', exportMemory, busy || !snapshot?.record))),
        details('当前记忆数据', snapshot?.record?.data ?? null),
        h('div', { style: styles.box },
          h('h3', { style: styles.heading }, '导入 JSON（替换当前记忆）'),
          h('label', null, '选择记忆 JSON 文件（最多 49152 字节）', h('input', { type: 'file', accept: '.json,application/json', disabled: busy, onChange: selectFile, 'aria-label': '记忆 JSON 文件' })),
          h('label', null, '记忆 JSON 文本', h('textarea', { style: styles.textarea, value: text, disabled: busy, onChange: event => changeInput(event.target.value), 'aria-label': '记忆 JSON 文本', spellCheck: false })),
          h('div', { style: styles.row }, button('预览记忆 JSON', requestPreview, busy || !text.trim()), button('确认替换记忆', importMemory, busy || !valid)),
          preview ? h('div', null, details('预览记忆数据', preview.data), details('预览条目计数', preview.counts), details('原有条目计数', preview.previousCounts), details('预览警告', preview.warnings)) : null),
        h('div', { style: styles.box },
          h('h3', { style: styles.heading }, '记忆注入模板'),
          h('p', { style: styles.muted }, '兼容 xbgetvar、xbgetvar_yaml、xbgetvar_yaml_idx 的简单旧卡路径（点号、下标、括号键、引号键）；只展开本模板，不会展开整张旧卡或执行写入宏。'),
          h('label', null, '记忆宏模板', h('textarea', { style: styles.textarea, value: template, disabled: busy, onChange: event => setTemplate(event.target.value), 'aria-label': '记忆宏模板', spellCheck: false })),
          button('保存记忆模板', () => settings({ macroTemplate: template }))),
        h('div', { style: styles.box },
          h('h3', { style: styles.heading }, '手动生成记忆候选'),
          h('div', { role: 'status', 'aria-label': '总结状态', style: styles.box },
            h('strong', null, '总结状态'),
            h('p', { role: ['failed', 'stale'].includes(snapshot?.summaryStatus?.status) ? 'alert' : undefined, style: styles.muted }, summaryMessage(snapshot?.summaryStatus, candidate))),
          h('p', { style: styles.muted }, '每次最多 20 轮，先生成增量提案供你审核；确认采用已选变更后才更新记忆。使用本局后台模型额度，可能产生费用；宿主可能附带人物卡、世界书和最近剧情。'),
          h('div', { style: styles.row },
            h('label', null, '起始轮', h('input', { type: 'number', min: 1, value: from, disabled: busy, onChange: event => setFrom(event.target.value), 'aria-label': '起始轮' })),
            h('label', null, '结束轮', h('input', { type: 'number', min: 1, value: to, disabled: busy, onChange: event => setTo(event.target.value), 'aria-label': '结束轮' })),
            button('生成记忆候选（使用模型额度）', startSummary, busy || !!candidate || ['queued', 'running'].includes(snapshot?.summaryStatus?.status))),
          candidate ? h('div', null,
            h('p', { style: styles.muted }, '这是增量提案。旧记忆未出现在新总结中的条目会自动保留；新事实若与同一人物和类别的旧事实相关，默认不追加，需你明确选择。'),
            details('模型提交的完整提案', candidate.data),
            merge ? h('div', { style: styles.box },
              h('h4', { style: styles.heading }, '新增条目（普通新增默认采用）'),
              ...(merge.added || []).filter(item => item.selected !== false).map(item => h('label', { key: item.id, style: Object.assign({}, styles.row, { display: 'flex', margin: '6px 0' }) },
                h('input', { type: 'checkbox', checked: mergeChoices[item.id] !== false && item.selected !== false, onChange: event => mergeChoice(item.id, event.target.checked) }),
                h('span', null, item.kind + ' · ' + json(item.next))))) : null,
            merge ? h('div', { style: styles.box },
              h('h4', { style: styles.heading }, '潜在冲突与变更（默认保留旧项）'),
              ...(merge.conflicts || []).map(item => h('div', { key: item.id, style: styles.box },
                h('p', { style: styles.muted }, item.reason === 'related-fact' ? '相关事实：旧记忆与新事实并列，请选择是否追加' : '同一条目的内容变化，请选择保留旧项或替换'),
                h('pre', { style: styles.pre }, '旧：' + json(item.old) + '\n新：' + json(item.next)),
                item.reason === 'related-fact'
                  ? h('label', null, h('input', { type: 'checkbox', checked: mergeChoices[item.id] === 'add', onChange: event => mergeChoice(item.id, event.target.checked ? 'add' : 'keep') }), '追加这条事实')
                  : h('label', null, h('input', { type: 'checkbox', checked: mergeChoices[item.id] === 'replace', onChange: event => mergeChoice(item.id, event.target.checked ? 'replace' : 'keep') }), '用新内容替换旧项')))) : null,
            merge ? details('保留的旧条目', merge.retained) : null,
            h('div', { style: styles.row }, button('确认采用已选增量', commitSummary, busy || identity(candidate) !== identity(snapshot)), button('丢弃候选', discardSummary))) : null),
        snapshot?.limits ? details('记忆限制', snapshot.limits) : null)
    }

    function Panel({ ui, gameId }) {
      const [tab, setTab] = React.useState('state')
      return h('div', { style: styles.viewport }, h('div', { style: styles.stack },
        h('aside', { 'aria-label': '项目来源与署名', style: styles.box },
          h('strong', null, 'LWB Bridge · 第三方兼容扩展'),
          h('p', { style: styles.muted }, 'Based on LittleWhiteBox by biex'),
          h('p', { style: styles.muted }, '源自 LittleWhiteBox（小白X），公开修改版；非原项目或 Tavern 官方发布。'),
          h('a', { href: 'https://github.com/RT15548/LittleWhiteBox', target: '_blank', rel: 'noopener noreferrer' }, '原项目与作者'),
          ' · ', h('a', { href: 'https://github.com/Sophiacyl/dsh-tavern-lwb', target: '_blank', rel: 'noopener noreferrer' }, '本扩展公开源码')),
        h('div', { role: 'tablist', 'aria-label': '小白面板', style: Object.assign({}, styles.row, { flexShrink: 0 }) },
          ['state', 'memory'].map(name => h('button', { key: name, type: 'button', role: 'tab', 'aria-selected': tab === name, style: styles.button, onClick: () => setTab(name) }, name === 'state' ? 'State' : '记忆'))),
        tab === 'state' ? h(StatePanel, { ui, gameId }) : h(MemoryPanel, { ui, gameId })))
    }

    return {
      name: NAME,
      inject: ['tavernUi'],
      apply(ctx) {
        // Registration errors must never prevent Tavern from starting.
        try {
          const ui = ctx && ctx.tavernUi
          if (!ui || !(ui.apiVersion >= 7) || typeof ui.registerPanel !== 'function' || typeof ui.callHost !== 'function') return
          ui.registerPanel({ id: 'state', title: 'LWB Bridge', render: ({ gameId }) => h(Panel, { key: gameId, ui, gameId }) })
        } catch (failure) {
          try { console.warn(NAME + ': 小白状态面板注册失败', errorText(failure)) } catch (_) {}
        }
      },
    }
  },
})
