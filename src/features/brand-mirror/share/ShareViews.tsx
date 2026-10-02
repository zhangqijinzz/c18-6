import { SHARE_ERROR_COPY, formatShareDateTime } from '../services/shareService'

export function ReadOnlyBanner({ sharedAt, expiresAt, onExit }: { sharedAt: number; expiresAt: number | null; onExit: () => void }) {
  return (
    <div className="readonly-banner" role="status">
      <span className="readonly-lock">🔒</span>
      <div className="readonly-copy">
        <strong>只读分享视图</strong>
        <small>
          冻结于 {formatShareDateTime(sharedAt)} · {expiresAt === null ? '永久有效' : `${formatShareDateTime(expiresAt)} 前可查看`}
          ，展示的令牌、版本与样例与分享时一致，无法修改
        </small>
      </div>
      <button className="secondary-button" type="button" onClick={onExit}>回到本地工作区 ↩</button>
    </div>
  )
}

export function ShareErrorView({ reason, onExit }: { reason: keyof typeof SHARE_ERROR_COPY; onExit: () => void }) {
  const copy = SHARE_ERROR_COPY[reason]
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup"><span className="brand-mark">✦</span><span>BrandMirror</span><span className="brand-subtitle">品牌视觉实验室</span></div>
      </header>
      <main className="share-error-wrap">
        <div className="share-error-card">
          <div className="share-error-icon">⚠</div>
          <span className="eyebrow">SHARED LINK UNAVAILABLE</span>
          <h1>{copy.title}</h1>
          <p>{copy.body}</p>
          <div className="share-error-safe">
            <span className="live-dot" />
            你的本地工作区没有被读取或修改，仍然安全可用。
          </div>
          <button className="primary-button" type="button" onClick={onExit}>回到我的本地工作区</button>
          <small className="share-error-hint">点击后将从本机浏览器中恢复你最近一次的编辑，分享内容不会被写入。</small>
        </div>
      </main>
    </div>
  )
}
