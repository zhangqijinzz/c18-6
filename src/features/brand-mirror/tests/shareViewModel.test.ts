import { describe, expect, it } from 'vitest'
import { BrandMirrorViewModel } from '../viewmodels/brandMirrorViewModel'
import type { BrandDocument } from '../models/brandMirrorModels'
import type { BrandRepository } from '../repositories/brandRepository'
import { createShareToken } from '../services/shareService'
import { INITIAL_TOKENS } from '../models/brandMirrorModels'

class MemoryRepository implements BrandRepository {
  document: BrandDocument | null = null
  saveCount = 0
  load(): BrandDocument | null { return this.document }
  save(document: BrandDocument): void { this.saveCount += 1; this.document = document }
}

const localDocument: BrandDocument = {
  version: 1,
  theme: 'night',
  tokens: { ...INITIAL_TOKENS, primary: '#A98BFF', radiusScale: [6, 10, 14, 22], spacingScale: [4, 8, 12, 18, 28], typeScale: [12, 14, 16, 20, 28, 38] },
  versions: [{ id: 'version-1', label: 'Version A', createdAt: '2026-09-01T00:00:00.000Z', tokens: { ...INITIAL_TOKENS } }],
}

describe('BrandMirrorViewModel 只读分享模式', () => {
  it('打开分享 token 时显示冻结内容，且完全不触碰本地存储', () => {
    const repository = new MemoryRepository()
    repository.document = localDocument
    const viewModel = new BrandMirrorViewModel(repository)
    const token = createShareToken({ version: 1, theme: 'studio', tokens: INITIAL_TOKENS, versions: [] }, { ttlDays: 30 })

    viewModel.initialize(token)
    const snapshot = viewModel.getSnapshot()
    expect(snapshot.mode).toBe('shared')
    expect(snapshot.tokens.primary).toBe(INITIAL_TOKENS.primary)
    expect(snapshot.sharedAt).not.toBeNull()
    expect(snapshot.shareExpiresAt).not.toBeNull()
    // 本地 night 文档没有被加载，也没有被覆盖。
    expect(repository.saveCount).toBe(0)
    expect(repository.document).toBe(localDocument)
  })

  it('只读模式下所有修改操作都是 no-op：快照不变、本地不写入，并给出提示', () => {
    const repository = new MemoryRepository()
    repository.document = localDocument
    const viewModel = new BrandMirrorViewModel(repository)
    viewModel.initialize(createShareToken({ version: 1, theme: 'studio', tokens: INITIAL_TOKENS, versions: [] }))

    const before = viewModel.getSnapshot()
    viewModel.updateColor('primary', '#123456')
    viewModel.updateScale('typeScale', 0, 66)
    viewModel.selectTheme('night')
    viewModel.reset()
    viewModel.saveVersion()
    const after = viewModel.getSnapshot()

    expect(after.tokens).toEqual(before.tokens)
    expect(after.versions).toEqual(before.versions)
    expect(after.message).toContain('只读')
    expect(repository.saveCount).toBe(0)
    expect(repository.document).toBe(localDocument)
  })

  it('只读模式下仍可切换对比视图与导出（不产生写入）', () => {
    const repository = new MemoryRepository()
    const viewModel = new BrandMirrorViewModel(repository)
    const document: BrandDocument = {
      version: 1,
      theme: 'studio',
      tokens: INITIAL_TOKENS,
      versions: [
        { id: 'a', label: 'Version A', createdAt: '2026-09-01T00:00:00.000Z', tokens: INITIAL_TOKENS },
        { id: 'b', label: 'Version B', createdAt: '2026-09-02T00:00:00.000Z', tokens: { ...INITIAL_TOKENS, primary: '#238B73' } },
      ],
    }
    viewModel.initialize(createShareToken(document))
    viewModel.toggleCompare()
    expect(viewModel.getSnapshot().compareMode).toBe(true)
    expect(repository.saveCount).toBe(0)
  })

  it('退出分享后恢复本地工作区，分享内容不会写入本地', () => {
    const repository = new MemoryRepository()
    repository.document = localDocument
    const viewModel = new BrandMirrorViewModel(repository)
    viewModel.initialize(createShareToken({ version: 1, theme: 'studio', tokens: INITIAL_TOKENS, versions: [] }))
    expect(viewModel.getSnapshot().mode).toBe('shared')

    viewModel.exitShareMode()
    const snapshot = viewModel.getSnapshot()
    expect(snapshot.mode).toBe('local')
    expect(snapshot.theme).toBe('night')
    expect(repository.document).toBe(localDocument)
    expect(repository.saveCount).toBe(0)
  })

  it('退出分享时若本地没有工作区，则安全进入默认工作区', () => {
    const repository = new MemoryRepository()
    const viewModel = new BrandMirrorViewModel(repository)
    viewModel.initialize(createShareToken({ version: 1, theme: 'studio', tokens: INITIAL_TOKENS, versions: [] }))
    viewModel.exitShareMode()
    expect(viewModel.getSnapshot().mode).toBe('local')
    expect(viewModel.getSnapshot().theme).toBe('studio')
    expect(repository.saveCount).toBe(0)
  })
})

describe('BrandMirrorViewModel 分享链接异常退回', () => {
  it('截断链接进入 share-error 安全状态，不加载本地也不白屏', () => {
    const repository = new MemoryRepository()
    repository.document = localDocument
    const viewModel = new BrandMirrorViewModel(repository)
    const token = createShareToken({ version: 1, theme: 'studio', tokens: INITIAL_TOKENS, versions: [] })
    viewModel.initialize(token.slice(0, 20))

    const snapshot = viewModel.getSnapshot()
    expect(snapshot.mode).toBe('share-error')
    expect(snapshot.status).toBe('error')
    expect(snapshot.shareError).toBe('malformed')
    expect(repository.saveCount).toBe(0)
  })

  it('过期链接进入 share-error 且原因为 expired', () => {
    const repository = new MemoryRepository()
    const viewModel = new BrandMirrorViewModel(repository)
    const now = new Date('2026-01-01T00:00:00.000Z').getTime()
    const token = createShareToken({ version: 1, theme: 'studio', tokens: INITIAL_TOKENS, versions: [] }, { ttlDays: 7, now })
    viewModel.initialize(token)
    expect(viewModel.getSnapshot().mode).toBe('share-error')
    expect(viewModel.getSnapshot().shareError).toBe('expired')
  })

  it('share-error 状态下退出可进入本地工作区，本地数据完好', () => {
    const repository = new MemoryRepository()
    repository.document = localDocument
    const viewModel = new BrandMirrorViewModel(repository)
    viewModel.initialize('broken')
    expect(viewModel.getSnapshot().mode).toBe('share-error')
    viewModel.exitShareMode()
    expect(viewModel.getSnapshot().mode).toBe('local')
    expect(viewModel.getSnapshot().theme).toBe('night')
    expect(repository.saveCount).toBe(0)
  })

  it('无分享 token 时维持原有本地行为', () => {
    const repository = new MemoryRepository()
    repository.document = localDocument
    const viewModel = new BrandMirrorViewModel(repository)
    viewModel.initialize()
    expect(viewModel.getSnapshot().mode).toBe('local')
    expect(viewModel.getSnapshot().theme).toBe('night')
  })
})
