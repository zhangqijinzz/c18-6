import type { BrandDocument } from '../models/brandMirrorModels'
import { clampTokenValues, isValidTokenShape, validateTokens } from '../domain/brandRules'
import type { StorageService } from '../services/storageService'

export interface BrandRepository {
  load(): BrandDocument | null
  save(document: BrandDocument): void
}

export class LocalBrandRepository implements BrandRepository {
  constructor(private readonly storage: StorageService) {}

  load(): BrandDocument | null {
    const raw = this.storage.read()
    if (!raw) return null
    try {
      const candidate: unknown = JSON.parse(raw)
      if (!isDocument(candidate)) return null
      return { ...candidate, tokens: clampTokenValues(candidate.tokens) }
    } catch {
      return null
    }
  }

  save(document: BrandDocument): void {
    const validationError = validateTokens(document.tokens)
    if (validationError) throw new Error(validationError)
    this.storage.write(JSON.stringify(document))
  }
}

export class ReadOnlyBrandRepository implements BrandRepository {
  load(): BrandDocument | null {
    return null
  }

  save(): void {
    throw new Error('分享视图为只读，不能写入工作区')
  }
}

function isDocument(value: unknown): value is BrandDocument {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<BrandDocument>
  return candidate.version === 1 && isValidTokenShape(candidate.tokens) && Array.isArray(candidate.versions) && typeof candidate.theme === 'string'
}
