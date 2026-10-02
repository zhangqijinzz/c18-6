import { useState } from 'react'
import type { BrandMirrorViewModel } from '../viewmodels/brandMirrorViewModel'
import { useBrandMirrorViewModel } from '../hooks/useBrandMirrorViewModel'
import { ComponentGallery } from '../preview-gallery/ComponentGallery'
import { PageGallery } from '../preview-gallery/PageGallery'
import { TokenControls } from '../token-editor/TokenControls'
import { TokenExplorer } from '../token-search/TokenExplorer'
import { VersionCompare } from '../versioning/VersionCompare'
import { ShareDialog } from '../share/ShareDialog'
import { ReadOnlyBanner, ShareErrorView } from '../share/ShareViews'

interface BrandMirrorPageProps {
  viewModel: BrandMirrorViewModel
  shareToken?: string | null
  onExitShare: () => void
}

export function BrandMirrorPage({ viewModel, shareToken, onExitShare }: BrandMirrorPageProps) {
  const snapshot = useBrandMirrorViewModel(viewModel, shareToken)
  const [shareOpen, setShareOpen] = useState(false)

  if (snapshot.mode === 'share-error' && snapshot.shareError) {
    return <ShareErrorView reason={snapshot.shareError} onExit={onExitShare} />
  }

  const readOnly = snapshot.mode === 'shared'

  return <div className="app-shell"><header className="topbar"><div className="brand-lockup"><span className="brand-mark">✦</span><span>BrandMirror</span><span className="brand-subtitle">品牌视觉实验室</span></div><div className="topbar-right">{readOnly ? <span className="save-state readonly-pill"><span className="readonly-dot" />只读分享</span> : <span className="save-state"><span className="live-dot" />{snapshot.status === 'error' ? '本地保存需检查' : '所有更改已保存'}</span>}{!readOnly && <button className="share-trigger" type="button" onClick={() => setShareOpen(true)}>↗ 分享只读链接</button>}<span className="avatar-small">M</span></div></header>
    {readOnly && snapshot.sharedAt !== null && <ReadOnlyBanner sharedAt={snapshot.sharedAt} expiresAt={snapshot.shareExpiresAt} onExit={onExitShare} />}
    <main className="workspace"><div><TokenControls snapshot={snapshot} readOnly={readOnly} onThemeChange={(theme) => viewModel.selectTheme(theme)} onColorChange={(field, value) => viewModel.updateColor(field, value)} onScaleChange={(field, index, value) => viewModel.updateScale(field, index, value)} onReset={() => viewModel.reset()} /><TokenExplorer tokens={snapshot.tokens} /></div><div className="preview-area"><div className="hero-heading"><div><span className="eyebrow">BRAND SYSTEM / 2024</span><h1>一套令牌，<em>无限可能。</em></h1><p>{readOnly ? '你正在查看分享时冻结的令牌快照，以下样例与分享时完全一致。' : '调整左侧令牌，观察它们如何在不同组件和页面中保持一致。'}</p></div><div className="feedback-toast"><span className="toast-icon">✦</span><span><strong>{snapshot.message || (readOnly ? '只读快照' : '准备开始探索')}</strong><small>{readOnly ? '分享视图 · 不会改动本地' : '实时视觉反馈'}</small></span></div></div><ComponentGallery tokens={snapshot.tokens} /><PageGallery tokens={snapshot.tokens} /><VersionCompare snapshot={snapshot} onSave={() => viewModel.saveVersion()} onToggle={() => viewModel.toggleCompare()} onExport={() => viewModel.exportBrandGuidelines()} /></div></main><footer className="bottom-status"><span><span className={readOnly ? 'readonly-dot' : 'live-dot'} />{readOnly ? '只读分享视图 · 未连接本地工作区，本地数据保持不变' : '已连接到本地工作区'}</span><span>BrandMirror v0.1 <span className="footer-sep">·</span> {readOnly ? '只读快照' : '本地优先'}</span></footer>
    {!readOnly && <ShareDialog open={shareOpen} snapshot={snapshot} onClose={() => setShareOpen(false)} />}
  </div>
}
