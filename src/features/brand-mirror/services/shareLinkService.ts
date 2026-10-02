import type { BrandDocument, SavedVersion, SharedWorkspace } from '../models/brandMirrorModels'
import { isValidTokenShape, validateTokens } from '../domain/brandRules'

export type ShareLinkResult =
  | { status: 'valid'; workspace: SharedWorkspace }
  | { status: 'expired'; message: string; expiredAt: string }
  | { status: 'invalid'; message: string }

export interface ShareLinkCodec {
  createShareLink(document: Omit<BrandDocument, 'version'>, createdAt?: Date): string
  parseHash(hash: string, now?: Date): ShareLinkResult
}

export interface ShareLinkService extends ShareLinkCodec {
  copyShareLink(link: string): Promise<void>
  clearShareHash(): void
  returnToLocalWorkspace(): void
}

const SHARE_PREFIX = '#/share/'
const SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MAX_LINK_LENGTH = 4000
const CHECKSUM_SALT = 'brandmirror.share.v1'

export class WorkspaceShareLinkCodec implements ShareLinkCodec {
  createShareLink(document: Omit<BrandDocument, 'version'>, createdAt = new Date()): string {
    const validationError = validateTokens(document.tokens)
    if (validationError) throw new Error(validationError)
    for (const version of document.versions) {
      const versionError = validateTokens(version.tokens)
      if (versionError) throw new Error(`版本 ${version.label} 无法分享：${versionError}`)
    }

    const expiresAt = new Date(createdAt.getTime() + SHARE_TTL_MS)
    const workspace: SharedWorkspace = {
      format: 'brandmirror-share',
      version: 1,
      tokens: document.tokens,
      theme: document.theme,
      versions: document.versions,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    }
    const encoded = encodeShareWorkspace(workspace)
    const link = `${SHARE_PREFIX}${encoded}`
    if (link.length > MAX_LINK_LENGTH) {
      throw new Error('分享内容过长，请减少保存的版本后再试')
    }
    return link
  }

  parseHash(hash: string, now = new Date()): ShareLinkResult {
    if (!hash.startsWith(SHARE_PREFIX)) return { status: 'invalid', message: '这不是完整的 BrandMirror 分享链接' }
    const encoded = hash.slice(SHARE_PREFIX.length)
    if (!encoded) return { status: 'invalid', message: '分享链接缺少内容，可能在复制时被截断' }

    try {
      const workspace = decodeShareWorkspace(encoded)
      const validationError = validateSharedWorkspace(workspace)
      if (validationError) return { status: 'invalid', message: validationError }

      const expiresAt = Date.parse(workspace.expiresAt)
      if (now.getTime() > expiresAt) {
        return {
          status: 'expired',
          expiredAt: workspace.expiresAt,
          message: `这份分享已于 ${formatDate(workspace.expiresAt)} 过期。为避免展示过时令牌，已安全退回你的本地工作区。`,
        }
      }
      return { status: 'valid', workspace }
    } catch {
      return { status: 'invalid', message: '分享链接已损坏、被截断或内容被改动，无法安全打开，已退回你的本地工作区。' }
    }
  }
}

export class BrowserShareLinkService extends WorkspaceShareLinkCodec implements ShareLinkService {
  async copyShareLink(link: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(link)
      return
    }

    const input = document.createElement('input')
    input.value = link
    input.setAttribute('readonly', '')
    input.style.position = 'fixed'
    input.style.opacity = '0'
    document.body.appendChild(input)
    input.select()
    const copied = document.execCommand('copy')
    input.remove()
    if (!copied) throw new Error('copy failed')
  }

  clearShareHash(): void {
    const url = new URL(window.location.href)
    url.hash = ''
    window.history.replaceState(null, '', url)
  }

  returnToLocalWorkspace(): void {
    this.clearShareHash()
    window.location.reload()
  }
}

function encodeShareWorkspace(workspace: SharedWorkspace): string {
  const envelope = { payload: workspace, checksum: checksum(workspace) }
  return base64UrlEncode(JSON.stringify(envelope))
}

function decodeShareWorkspace(encoded: string): SharedWorkspace {
  const envelope: unknown = JSON.parse(base64UrlDecode(encoded))
  if (!envelope || typeof envelope !== 'object') throw new Error('invalid share')
  const candidate = envelope as { payload?: unknown; checksum?: unknown }
  if (typeof candidate.checksum !== 'string' || !candidate.payload || typeof candidate.payload !== 'object') {
    throw new Error('invalid share')
  }

  const payload = candidate.payload as SharedWorkspace
  if (checksum(payload) !== candidate.checksum) throw new Error('tampered share')
  return payload
}

function validateSharedWorkspace(workspace: SharedWorkspace): string | null {
  if (workspace.format !== 'brandmirror-share' || workspace.version !== 1) return '分享内容来自不受支持的版本，无法安全读取'
  if (!isIsoDate(workspace.createdAt) || !isIsoDate(workspace.expiresAt)) return '分享时间信息无效'
  if (Date.parse(workspace.expiresAt) <= Date.parse(workspace.createdAt)) return '分享有效期无效'
  if (workspace.theme !== 'studio' && workspace.theme !== 'editorial' && workspace.theme !== 'night') return '分享中包含未知主题'

  if (!isValidTokenShape(workspace.tokens)) return '分享的当前令牌结构不完整'
  const tokenError = validateTokens(workspace.tokens)
  if (tokenError) return `分享的当前令牌无效：${tokenError}`
  if (!Array.isArray(workspace.versions)) return '分享中的版本信息无效'

  for (const version of workspace.versions) {
    if (!isSavedVersion(version)) return '分享中的版本记录不完整'
    const versionError = validateTokens(version.tokens)
    if (versionError) return `分享版本 ${version.label} 的令牌无效：${versionError}`
  }
  return null
}

function isSavedVersion(value: unknown): value is SavedVersion {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SavedVersion>
  return typeof candidate.id === 'string'
    && typeof candidate.label === 'string'
    && isValidTokenShape(candidate.tokens)
    && isIsoDate(candidate.createdAt ?? '')
}

function isIsoDate(value: string): boolean {
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString() === value
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function checksum(value: SharedWorkspace): string {
  let hash = 0x811C9DC5
  const input = `${CHECKSUM_SALT}:${canonicalJson(value)}`

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(value))
}
