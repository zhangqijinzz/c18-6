import { clampTokenValues, cloneTokens, contrastRatio, normalizeColor, themeTokens, validateTokens } from '../domain/brandRules'
import type { BrandRepository } from '../repositories/brandRepository'
import type { BrandGuidelinesExporter } from '../services/exportService'
import { decodeShareToken } from '../services/shareService'
import { INITIAL_TOKENS, type BrandDocument, type BrandMirrorSnapshot, type BrandTheme, type SavedVersion, type WorkspaceMode } from '../models/brandMirrorModels'

type Listener = () => void

const READ_ONLY_MESSAGE = '只读视图：分享内容无法修改，回到本地工作区后再调整令牌'

export class BrandMirrorViewModel {
  private snapshot: BrandMirrorSnapshot = this.makeSnapshot({ tokens: INITIAL_TOKENS, theme: 'studio', versions: [] })
  private readonly listeners = new Set<Listener>()
  private readonly repository: BrandRepository
  private readonly exporter?: BrandGuidelinesExporter

  constructor(repository: BrandRepository, exporter?: BrandGuidelinesExporter) {
    this.repository = repository
    this.exporter = exporter
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot(): BrandMirrorSnapshot {
    return this.snapshot
  }

  /**
   * 启动工作区。
   * - 传入分享 token 时只解析快照，绝不读写本地存储，成功后进入只读模式；
   *   解析失败则进入 share-error 模式并展示可理解的说明，同样不触碰本地数据。
   * - 未传入时按本地工作区处理（恢复 localStorage 中的最近状态）。
   */
  initialize(shareToken?: string | null): void {
    if (shareToken) {
      const result = decodeShareToken(shareToken)
      if (result.ok) {
        const { document, createdAt, expiresAt } = result
        this.snapshot = {
          ...this.makeSnapshot(document, '正在查看分享的只读快照（分享时的令牌与版本）', 'ready', 'shared'),
          sharedAt: createdAt,
          shareExpiresAt: expiresAt,
        }
      } else {
        this.snapshot = this.makeShareErrorSnapshot(result.reason)
      }
      this.emit()
      return
    }

    const stored = this.repository.load()
    if (stored) {
      this.snapshot = this.makeSnapshot(stored, '已恢复最近一次工作状态')
    } else {
      this.snapshot = this.makeSnapshot({ tokens: INITIAL_TOKENS, theme: 'studio', versions: [] }, '从 Studio warm 开始探索')
    }
    this.emit()
  }

  /** 从只读视图或分享错误页退出：清除分享状态并加载（绝不覆盖）本地工作区。 */
  exitShareMode(): void {
    if (this.snapshot.mode === 'local') return
    const stored = this.repository.load()
    if (stored) {
      this.snapshot = this.makeSnapshot(stored, '已回到你的本地工作区，分享内容未做任何修改')
    } else {
      this.snapshot = this.makeSnapshot({ tokens: INITIAL_TOKENS, theme: 'studio', versions: [] }, '已回到本地工作区')
    }
    this.emit()
  }

  selectTheme(theme: BrandTheme): void {
    if (this.guardReadOnly()) return
    this.update({ tokens: themeTokens(theme), theme }, '已切换基础主题')
  }

  updateColor(field: 'primary' | 'secondary', value: string): void {
    if (this.guardReadOnly()) return
    const color = normalizeColor(value)
    this.update({ tokens: { ...this.snapshot.tokens, [field]: color } }, '令牌已更新')
  }

  updateScale(field: 'radiusScale' | 'spacingScale' | 'typeScale', index: number, value: number): void {
    if (this.guardReadOnly()) return
    const values = [...this.snapshot.tokens[field]]
    values[index] = Number.isFinite(value) ? value : values[index]
    this.update({ tokens: clampTokenValues({ ...this.snapshot.tokens, [field]: values }) }, '令牌已更新')
  }

  reset(): void {
    if (this.guardReadOnly()) return
    this.update({ tokens: cloneTokens(INITIAL_TOKENS), theme: 'studio' }, '已恢复默认令牌')
  }

  saveVersion(): void {
    if (this.guardReadOnly()) return
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

  /** 对比视图只是切换查看方式，只读模式也允许；不产生任何写入。 */
  toggleCompare(): void {
    this.snapshot = { ...this.snapshot, compareMode: !this.snapshot.compareMode, message: this.snapshot.compareMode ? '已退出对比模式' : '正在对比最近两个版本' }
    this.emit()
  }

  exportBrandGuidelines(): void {
    if (!this.exporter) return
    try {
      this.exporter.export(this.snapshot)
      this.snapshot = { ...this.snapshot, message: this.snapshot.mode === 'shared' ? '已导出这份只读快照的品牌规范' : '品牌规范已导出' }
    } catch {
      this.snapshot = { ...this.snapshot, status: 'error', message: '导出失败，请稍后重试' }
    }
    this.emit()
  }

  /** 只读模式下拦截一切修改：不改快照、不写本地存储，只给出提示。 */
  private guardReadOnly(): boolean {
    if (this.snapshot.mode !== 'shared') return false
    this.snapshot = { ...this.snapshot, message: READ_ONLY_MESSAGE }
    this.emit()
    return true
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

  private makeSnapshot(
    document: Omit<BrandDocument, 'version'>,
    message = '',
    status: BrandMirrorSnapshot['status'] = 'ready',
    mode: WorkspaceMode = 'local',
  ): BrandMirrorSnapshot {
    const ratio = contrastRatio(document.tokens.primary, document.tokens.secondary)
    const latestVersion = document.versions[document.versions.length - 1]
    return {
      status,
      mode,
      tokens: cloneTokens(document.tokens),
      theme: document.theme,
      versions: document.versions,
      compareMode: false,
      activeVersionId: latestVersion?.id ?? null,
      contrastRatio: ratio,
      contrastWarning: ratio < 3,
      message,
      sharedAt: null,
      shareExpiresAt: null,
      shareError: null,
    }
  }

  private makeShareErrorSnapshot(reason: BrandMirrorSnapshot['shareError']): BrandMirrorSnapshot {
    return {
      status: 'error',
      mode: 'share-error',
      tokens: cloneTokens(INITIAL_TOKENS),
      theme: 'studio',
      versions: [],
      compareMode: false,
      activeVersionId: null,
      contrastRatio: contrastRatio(INITIAL_TOKENS.primary, INITIAL_TOKENS.secondary),
      contrastWarning: false,
      message: '',
      sharedAt: null,
      shareExpiresAt: null,
      shareError: reason,
    }
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener())
  }
}
