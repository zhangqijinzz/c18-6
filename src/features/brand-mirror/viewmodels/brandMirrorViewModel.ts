import { clampTokenValues, cloneTokens, contrastRatio, normalizeColor, themeTokens, validateTokens } from '../domain/brandRules'
import type { BrandRepository } from '../repositories/brandRepository'
import type { BrandGuidelinesExporter } from '../services/exportService'
import type { ShareLinkService } from '../services/shareLinkService'
import { INITIAL_TOKENS, type BrandDocument, type BrandMirrorSnapshot, type BrandTheme, type SavedVersion, type SharedWorkspace } from '../models/brandMirrorModels'

type Listener = () => void

export class BrandMirrorViewModel {
  private snapshot: BrandMirrorSnapshot = this.makeSnapshot({ tokens: INITIAL_TOKENS, theme: 'studio', versions: [] })
  private readonly listeners = new Set<Listener>()
  private readonly repository: BrandRepository
  private readonly exporter?: BrandGuidelinesExporter
  private readonly shareLinks?: ShareLinkService

  constructor(repository: BrandRepository, exporter?: BrandGuidelinesExporter, shareLinks?: ShareLinkService) {
    this.repository = repository
    this.exporter = exporter
    this.shareLinks = shareLinks
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot(): BrandMirrorSnapshot {
    return this.snapshot
  }

  initialize(): void {
    const stored = this.repository.load()
    if (stored) {
      this.snapshot = this.makeSnapshot(stored, '已恢复最近一次工作状态')
    } else {
      this.snapshot = this.makeSnapshot({ tokens: INITIAL_TOKENS, theme: 'studio', versions: [] }, '从 Studio warm 开始探索')
    }
    this.emit()
  }

  showShareNotice(message: string): void {
    this.snapshot = { ...this.snapshot, status: 'ready', message }
    this.emit()
  }

  initializeSharedWorkspace(workspace: SharedWorkspace): void {
    this.snapshot = this.makeSnapshot(
      workspace,
      `只读分享快照 · 分享于 ${formatSharedDate(workspace.createdAt)}，有效期至 ${formatSharedDate(workspace.expiresAt)}`,
      'ready',
      true,
      workspace,
    )
    this.emit()
  }

  selectTheme(theme: BrandTheme): void {
    if (this.snapshot.readOnly) {
      this.denyReadOnlyAction()
      return
    }
    this.update({ tokens: themeTokens(theme), theme }, '已切换基础主题')
  }

  updateColor(field: 'primary' | 'secondary', value: string): void {
    if (this.snapshot.readOnly) return this.denyReadOnlyAction()
    const color = normalizeColor(value)
    this.update({ tokens: { ...this.snapshot.tokens, [field]: color } }, '令牌已更新')
  }

  updateScale(field: 'radiusScale' | 'spacingScale' | 'typeScale', index: number, value: number): void {
    if (this.snapshot.readOnly) return this.denyReadOnlyAction()
    const values = [...this.snapshot.tokens[field]]
    values[index] = Number.isFinite(value) ? value : values[index]
    this.update({ tokens: clampTokenValues({ ...this.snapshot.tokens, [field]: values }) }, '令牌已更新')
  }

  reset(): void {
    if (this.snapshot.readOnly) {
      this.denyReadOnlyAction()
      return
    }
    this.update({ tokens: cloneTokens(INITIAL_TOKENS), theme: 'studio' }, '已恢复默认令牌')
  }

  saveVersion(): void {
    if (this.snapshot.readOnly) {
      this.denyReadOnlyAction()
      return
    }
    const validationError = validateTokens(this.snapshot.tokens)
    if (validationError) {
      this.snapshot = { ...this.snapshot, status: 'error', message: validationError }
      this.emit()
      return
    }
    const nextVersion: SavedVersion = {
      id: `version-${Date.now()}`,
      label: this.snapshot.versions.length === 0 ? 'Version A' : `Version ${String.fromCharCode(65 + this.snapshot.versions.length)}`,
      tokens: cloneTokens(this.snapshot.tokens),
      createdAt: new Date().toISOString(),
    }
    const versions = [...this.snapshot.versions, nextVersion]
    this.persist({ tokens: this.snapshot.tokens, theme: this.snapshot.theme, versions }, '版本已保存')
  }

  toggleCompare(): void {
    this.snapshot = { ...this.snapshot, compareMode: !this.snapshot.compareMode, message: this.snapshot.compareMode ? '已退出对比模式' : '正在对比最近两个版本' }
    this.emit()
  }

  exportBrandGuidelines(): void {
    if (!this.exporter) return
    try {
      this.exporter.export(this.snapshot)
      this.snapshot = { ...this.snapshot, message: '品牌规范已导出' }
    } catch {
      this.snapshot = { ...this.snapshot, status: 'error', message: '导出失败，请稍后重试' }
    }
    this.emit()
  }

  async createShareLink(): Promise<void> {
    if (!this.shareLinks || this.snapshot.readOnly) return
    const validationError = validateTokens(this.snapshot.tokens)
    if (validationError) {
      this.snapshot = { ...this.snapshot, status: 'error', message: validationError }
      this.emit()
      return
    }

    try {
      const link = this.shareLinks.createShareLink({ tokens: this.snapshot.tokens, theme: this.snapshot.theme, versions: this.snapshot.versions })
      await this.shareLinks.copyShareLink(link)
      this.snapshot = { ...this.snapshot, message: '只读分享链接已复制，30 天内有效' }
    } catch (error) {
      this.snapshot = { ...this.snapshot, status: 'error', message: error instanceof Error ? error.message : '分享链接创建失败，请稍后重试' }
    }
    this.emit()
  }

  returnToLocalWorkspace(): void {
    this.shareLinks?.returnToLocalWorkspace()
  }

  private update(partial: Partial<Pick<BrandDocument, 'tokens' | 'theme'>>, message: string): void {
    const tokens = partial.tokens ?? this.snapshot.tokens
    this.snapshot = this.makeSnapshot({ tokens, theme: partial.theme ?? this.snapshot.theme, versions: this.snapshot.versions }, message, 'editing')
    this.persistCurrent()
  }

  private persistCurrent(): void {
    try {
      this.repository.save({ version: 1, tokens: this.snapshot.tokens, theme: this.snapshot.theme, versions: this.snapshot.versions })
    } catch {
      this.snapshot = { ...this.snapshot, status: 'error', message: '本地保存失败，但当前编辑仍保留在页面中' }
    }
    this.emit()
  }

  private persist(document: Omit<BrandDocument, 'version'>, message: string): void {
    try {
      this.repository.save({ version: 1, ...document })
      this.snapshot = this.makeSnapshot(document, message, 'ready')
    } catch {
      this.snapshot = { ...this.snapshot, status: 'error', message: '版本保存失败，请稍后重试' }
    }
    this.emit()
  }

  private denyReadOnlyAction(): void {
    this.snapshot = { ...this.snapshot, message: '当前是只读分享视图，不能修改；退出后可继续编辑你的本地工作区' }
    this.emit()
  }

  private makeSnapshot(document: Omit<BrandDocument, 'version'>, message = '', status: BrandMirrorSnapshot['status'] = 'ready', readOnly = false, sharedWorkspace?: SharedWorkspace): BrandMirrorSnapshot {
    const ratio = contrastRatio(document.tokens.primary, document.tokens.secondary)
    const latestVersion = document.versions[document.versions.length - 1]
    const share = sharedWorkspace
      ? { createdAt: sharedWorkspace.createdAt, expiresAt: sharedWorkspace.expiresAt }
      : null
    return { status, tokens: cloneTokens(document.tokens), theme: document.theme, versions: document.versions, compareMode: false, activeVersionId: latestVersion?.id ?? null, contrastRatio: ratio, contrastWarning: ratio < 3, message, readOnly, share }
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener())
  }
}

function formatSharedDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
}
