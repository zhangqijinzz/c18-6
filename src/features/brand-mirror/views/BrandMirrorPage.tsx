import type { BrandMirrorViewModel } from '../viewmodels/brandMirrorViewModel'
import { useBrandMirrorViewModel } from '../hooks/useBrandMirrorViewModel'
import { ComponentGallery } from '../preview-gallery/ComponentGallery'
import { PageGallery } from '../preview-gallery/PageGallery'
import { TokenControls } from '../token-editor/TokenControls'
import { TokenExplorer } from '../token-search/TokenExplorer'
import { VersionCompare } from '../versioning/VersionCompare'
import type { SharedWorkspace } from '../models/brandMirrorModels'

interface BrandMirrorPageProps {
  viewModel: BrandMirrorViewModel
  sharedWorkspace?: SharedWorkspace | null
  shareNotice?: string | null
}

export function BrandMirrorPage({ viewModel, sharedWorkspace = null, shareNotice = null }: BrandMirrorPageProps) {
  const snapshot = useBrandMirrorViewModel(viewModel, { sharedWorkspace, shareNotice })
  const isReadOnly = snapshot.readOnly

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">✦</span>
          <span>BrandMirror</span>
          <span className="brand-subtitle">品牌视觉实验室</span>
        </div>
        <div className="topbar-right">
          {isReadOnly
            ? <span className="readonly-pill">只读分享</span>
            : <button className="share-button" type="button" onClick={() => viewModel.createShareLink()}>复制分享链接</button>}
          <span className="save-state"><span className={`live-dot ${isReadOnly ? 'read-only' : ''}`} />{isReadOnly ? '分享快照已冻结' : snapshot.status === 'error' ? '本地保存需检查' : '所有更改已保存'}</span>
          <span className="avatar-small">M</span>
        </div>
      </header>

      {(isReadOnly || shareNotice) && (
        <div className={`share-banner ${shareNotice ? 'warning' : ''}`}>
          <strong>{shareNotice ? '无法打开这份分享' : '你正在查看只读分享'}</strong>
          <span>{shareNotice ?? snapshot.message}</span>
          {isReadOnly && <button type="button" onClick={() => viewModel.returnToLocalWorkspace()}>返回我的本地工作区</button>}
        </div>
      )}

      <main className="workspace">
        <div>
          <TokenControls
            snapshot={snapshot}
            readOnly={isReadOnly}
            onThemeChange={(theme) => viewModel.selectTheme(theme)}
            onColorChange={(field, value) => viewModel.updateColor(field, value)}
            onScaleChange={(field, index, value) => viewModel.updateScale(field, index, value)}
            onReset={() => viewModel.reset()}
          />
          <TokenExplorer tokens={snapshot.tokens} />
        </div>
        <div className="preview-area">
          <div className="hero-heading">
            <div>
              <span className="eyebrow">BRAND SYSTEM / 2024</span>
              <h1>一套令牌，<em>无限可能。</em></h1>
              <p>调整左侧令牌，观察它们如何在不同组件和页面中保持一致。</p>
            </div>
            <div className="feedback-toast">
              <span className="toast-icon">✦</span>
              <span><strong>{snapshot.message || '准备开始探索'}</strong><small>{isReadOnly ? '只读视觉反馈' : '实时视觉反馈'}</small></span>
            </div>
          </div>
          <ComponentGallery tokens={snapshot.tokens} />
          <PageGallery tokens={snapshot.tokens} />
          <VersionCompare
            snapshot={snapshot}
            readOnly={isReadOnly}
            onSave={() => viewModel.saveVersion()}
            onToggle={() => viewModel.toggleCompare()}
            onExport={() => viewModel.exportBrandGuidelines()}
          />
        </div>
      </main>
      <footer className="bottom-status">
        <span><span className={`live-dot ${isReadOnly ? 'read-only' : ''}`} />{isReadOnly ? '正在查看冻结的分享快照' : '已连接到本地工作区'}</span>
        <span>BrandMirror v0.1 <span className="footer-sep">·</span> {isReadOnly ? '只读链接' : '本地优先'}</span>
      </footer>
    </div>
  )
}
