import { describe, expect, it } from 'vitest'
import { INITIAL_TOKENS, type BrandDocument } from '../models/brandMirrorModels'
import { WorkspaceShareLinkCodec } from '../services/shareLinkService'

const document: Omit<BrandDocument, 'version'> = {
  tokens: INITIAL_TOKENS,
  theme: 'studio',
  versions: [
    {
      id: 'version-a',
      label: 'Version A',
      tokens: INITIAL_TOKENS,
      createdAt: '2026-09-30T10:00:00.000Z',
    },
  ],
}

describe('WorkspaceShareLinkCodec', () => {
  it('creates and parses a frozen read-only workspace link', () => {
    const codec = new WorkspaceShareLinkCodec()
    const createdAt = new Date('2026-10-01T08:00:00.000Z')
    const link = codec.createShareLink(document, createdAt)
    const parsed = codec.parseHash(link, createdAt)

    expect(link.startsWith('#/share/')).toBe(true)
    expect(parsed.status).toBe('valid')
    if (parsed.status !== 'valid') return
    expect(parsed.workspace.tokens).toEqual(INITIAL_TOKENS)
    expect(parsed.workspace.versions).toHaveLength(1)
    expect(parsed.workspace.expiresAt).toBe('2026-10-31T08:00:00.000Z')
  })

  it('rejects a truncated link with an understandable message', () => {
    const codec = new WorkspaceShareLinkCodec()
    const link = codec.createShareLink(document, new Date('2026-10-01T08:00:00.000Z'))
    const parsed = codec.parseHash(link.slice(0, -4), new Date('2026-10-01T08:00:00.000Z'))

    expect(parsed.status).toBe('invalid')
    if (parsed.status !== 'invalid') return
    expect(parsed.message).toContain('截断')
  })

  it('rejects a tampered payload rather than showing altered values', () => {
    const codec = new WorkspaceShareLinkCodec()
    const createdAt = new Date('2026-10-01T08:00:00.000Z')
    const link = codec.createShareLink(document, createdAt)
    const parsed = codec.parseHash(link.replace(/F/g, 'A'), createdAt)

    expect(parsed.status).toBe('invalid')
  })

  it('reports expiry after 30 days', () => {
    const codec = new WorkspaceShareLinkCodec()
    const createdAt = new Date('2026-10-01T08:00:00.000Z')
    const link = codec.createShareLink(document, createdAt)
    const parsed = codec.parseHash(link, new Date('2026-10-31T08:00:01.000Z'))

    expect(parsed.status).toBe('expired')
    if (parsed.status !== 'expired') return
    expect(parsed.message).toContain('过期')
  })
})
