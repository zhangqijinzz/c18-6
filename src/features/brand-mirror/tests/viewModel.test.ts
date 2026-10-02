import { describe, expect, it } from 'vitest'
import { BrandMirrorViewModel } from '../viewmodels/brandMirrorViewModel'
import type { BrandDocument } from '../models/brandMirrorModels'
import type { BrandRepository } from '../repositories/brandRepository'
import { buildBrandGuidelinesMarkdown, type BrandGuidelinesExporter } from '../services/exportService'
import { WorkspaceShareLinkCodec, type ShareLinkService } from '../services/shareLinkService'

class MemoryRepository implements BrandRepository {
  document: BrandDocument | null = null
  shouldFail = false
  load(): BrandDocument | null { return this.document }
  save(document: BrandDocument): void { if (this.shouldFail) throw new Error('offline'); this.document = document }
}

class MemoryExporter implements BrandGuidelinesExporter {
  received: string | null = null
  export(snapshot: Parameters<BrandGuidelinesExporter['export']>[0]): void { this.received = buildBrandGuidelinesMarkdown(snapshot) }
}

class MemoryShareLinkService extends WorkspaceShareLinkCodec implements ShareLinkService {
  copiedLink: string | null = null
  returnedToLocal = false
  clearedHash = false

  async copyShareLink(link: string): Promise<void> { this.copiedLink = link }
  clearShareHash(): void { this.clearedHash = true }
  returnToLocalWorkspace(): void { this.returnedToLocal = true }
}

describe('BrandMirrorViewModel', () => {
  it('initializes, updates tokens and persists the latest state', () => {
    const repository = new MemoryRepository()
    const viewModel = new BrandMirrorViewModel(repository)
    viewModel.initialize()
    viewModel.updateColor('primary', '#123456')
    viewModel.updateScale('typeScale', 0, 18)
    expect(viewModel.getSnapshot().tokens.primary).toBe('#123456')
    expect(viewModel.getSnapshot().tokens.typeScale[0]).toBe(18)
    expect(repository.document?.tokens.primary).toBe('#123456')
  })

  it('saves two versions and enters comparison mode', () => {
    const repository = new MemoryRepository()
    const viewModel = new BrandMirrorViewModel(repository)
    viewModel.initialize()
    viewModel.saveVersion()
    viewModel.updateColor('primary', '#238B73')
    viewModel.saveVersion()
    viewModel.toggleCompare()
    expect(viewModel.getSnapshot().versions.map((version) => version.label)).toEqual(['Version A', 'Version B'])
    expect(viewModel.getSnapshot().compareMode).toBe(true)
  })

  it('keeps editing usable when persistence fails', () => {
    const repository = new MemoryRepository()
    const viewModel = new BrandMirrorViewModel(repository)
    viewModel.initialize()
    repository.shouldFail = true
    viewModel.updateColor('secondary', '#FFFFFF')
    expect(viewModel.getSnapshot().status).toBe('error')
    expect(viewModel.getSnapshot().tokens.secondary).toBe('#FFFFFF')
  })

  it('recovers a previously persisted document on initialization', () => {
    const repository = new MemoryRepository()
    repository.document = { version: 1, theme: 'night', tokens: { primary: '#A98BFF', secondary: '#191829', radiusScale: [6, 10, 14, 22], spacingScale: [4, 8, 12, 18, 28], typeScale: [12, 14, 16, 20, 28, 38] }, versions: [] }
    const viewModel = new BrandMirrorViewModel(repository)
    viewModel.initialize()
    expect(viewModel.getSnapshot().theme).toBe('night')
    expect(viewModel.getSnapshot().message).toContain('恢复')
  })

  it('exports the current token system as brand guidelines', () => {
    const repository = new MemoryRepository()
    const exporter = new MemoryExporter()
    const viewModel = new BrandMirrorViewModel(repository, exporter)
    viewModel.initialize()
    viewModel.exportBrandGuidelines()
    expect(exporter.received).toContain('# BrandMirror 品牌规范')
    expect(exporter.received).toContain('`primary`')
    expect(viewModel.getSnapshot().message).toContain('导出')
  })

  it('creates a copyable share link without changing the local repository', async () => {
    const repository = new MemoryRepository()
    const shareLinks = new MemoryShareLinkService()
    const viewModel = new BrandMirrorViewModel(repository, undefined, shareLinks)
    viewModel.initialize()
    await viewModel.createShareLink()

    expect(shareLinks.copiedLink).toContain('#/share/')
    expect(repository.document).toBeNull()
    expect(viewModel.getSnapshot().message).toContain('只读')
  })

  it('keeps a shared workspace read-only and does not write to a local repository', () => {
    const repository = new MemoryRepository()
    const shareLinks = new MemoryShareLinkService()
    const link = shareLinks.createShareLink({ theme: 'night', tokens: { primary: '#A98BFF', secondary: '#191829', radiusScale: [6, 10, 14, 22], spacingScale: [4, 8, 12, 18, 28], typeScale: [12, 14, 16, 20, 28, 38] }, versions: [] }, new Date('2026-10-01T00:00:00.000Z'))
    const parsed = shareLinks.parseHash(link, new Date('2026-10-01T00:00:00.000Z'))
    expect(parsed.status).toBe('valid')
    if (parsed.status !== 'valid') return

    const viewModel = new BrandMirrorViewModel(repository, undefined, shareLinks)
    viewModel.initializeSharedWorkspace(parsed.workspace)
    viewModel.updateColor('primary', '#123456')
    viewModel.reset()
    viewModel.saveVersion()
    viewModel.returnToLocalWorkspace()

    expect(viewModel.getSnapshot().readOnly).toBe(true)
    expect(viewModel.getSnapshot().tokens.primary).toBe('#A98BFF')
    expect(viewModel.getSnapshot().message).toContain('只读')
    expect(repository.document).toBeNull()
    expect(shareLinks.returnedToLocal).toBe(true)
  })
})
