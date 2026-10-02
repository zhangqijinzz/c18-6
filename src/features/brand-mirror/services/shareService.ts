import { validateTokens } from '../domain/brandRules'
import type { BrandDocument, BrandTheme, BrandTokens, SavedVersion } from '../models/brandMirrorModels'

/**
 * 只读分享链接服务。
 *
 * 快照整体放在 URL hash 中（#share=<token>），不经过任何服务器：
 *   token = "<checksum>.<base64url-envelope>"
 *
 * checksum 为 FNV-1a-32（8 位十六进制），用于发现链接被截断或内容被改动/损坏；
 * 它不是加密签名，不能阻止有人刻意重算校验和——分享内容本身是设计令牌，不含敏感信息，
 * 校验和的职责是「发现意外损坏并拒绝显示可能错误的值」。
 */

export const SHARE_HASH_PARAM = 'share'
export const ENVELOPE_VERSION = 1
const DAY_MS = 24 * 60 * 60 * 1000
/** 防御性上限：异常超长的 token 直接判定为损坏，避免页面长时间解析。 */
const MAX_PAYLOAD_CHARS = 200_000

export type ShareErrorCode = 'malformed' | 'tampered' | 'expired' | 'unsupported' | 'invalid'

export interface ShareErrorDetail {
  reason: ShareErrorCode
  /** 仅在信封可信（校验通过）时返回，用于向用户展示过期时间。 */
  expiresAt?: number | null
}

export type ShareDecodeResult =
  | { ok: true; document: BrandDocument; createdAt: number; expiresAt: number | null }
  | ({ ok: false } & ShareErrorDetail)

export interface ShareErrorCopy {
  title: string
  body: string
}

/** 错误码 → 用户能理解的中文说明。退回安全状态，而不是白屏或错值。 */
export const SHARE_ERROR_COPY: Record<ShareErrorCode, ShareErrorCopy> = {
  malformed: {
    title: '无法打开这条分享链接',
    body: '链接中的内容不完整，可能是在复制或转发时被截断了。请让分享者重新发送完整链接，也可以先回到你自己的本地工作区。',
  },
  tampered: {
    title: '分享内容校验未通过',
    body: '链接里的内容与分享时不一致，可能已被修改或在传输中损坏。为避免展示错误的令牌数值，已停止加载这条链接。',
  },
  expired: {
    title: '这条分享链接已过期',
    body: '分享者为链接设置了有效期，到期后快照将不再可用。请联系对方重新生成一条分享链接。',
  },
  unsupported: {
    title: '链接版本不受支持',
    body: '这条链接来自更新版本的 BrandMirror，当前版本无法读取它的格式。请升级应用后再试。',
  },
  invalid: {
    title: '分享内容缺少必要信息',
    body: '快照中的令牌或版本数据不完整，无法还原分享时的工作区。请让分享者重新生成链接。',
  },
}

interface CompactTokens {
  p: string
  s: string
  r: number[]
  sp: number[]
  ty: number[]
}

interface CompactVersion {
  i: string
  l: string
  c: string
  t: CompactTokens
}

interface CompactDocument {
  h: BrandTheme
  t: CompactTokens
  vs: CompactVersion[]
}

interface ShareEnvelope {
  v: number
  d: CompactDocument
  i: number
  e: number | null
}

const THEMES: BrandTheme[] = ['studio', 'editorial', 'night']

export interface CreateShareOptions {
  /** 有效天数；null 表示永久有效。默认 30 天。 */
  ttlDays?: number | null
  now?: number
}

/** 把当前工作区编码成分享 token（不含 #share= 前缀）。令牌不合法时抛错。 */
export function createShareToken(document: BrandDocument, options: CreateShareOptions = {}): string {
  const ttlDays = options.ttlDays === undefined ? 30 : options.ttlDays
  const now = options.now ?? Date.now()

  const tokenError = validateTokens(document.tokens)
  if (tokenError) throw new Error(tokenError)
  if (document.versions.some((version) => validateTokens(version.tokens))) {
    throw new Error('保存的版本中存在不合法的令牌，无法分享')
  }
  if (ttlDays !== null && (!(Number.isFinite(ttlDays) && ttlDays > 0))) {
    throw new Error('分享有效期必须是正数天数或永久')
  }

  const envelope: ShareEnvelope = {
    v: ENVELOPE_VERSION,
    d: compactDocument(document),
    i: now,
    e: ttlDays === null ? null : now + Math.round(ttlDays * DAY_MS),
  }
  const payload = toBase64Url(JSON.stringify(envelope))
  return `${fnv1aHex(payload)}.${payload}`
}

/** 解析并严格校验分享 token。任何环节失败都返回明确的错误码，绝不抛出或返回半成品数据。 */
export function decodeShareToken(token: string, now: number = Date.now()): ShareDecodeResult {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_PAYLOAD_CHARS + 9) {
    return { ok: false, reason: 'malformed' }
  }
  const dot = token.indexOf('.')
  const checksum = dot === -1 ? '' : token.slice(0, dot)
  const payload = dot === -1 ? '' : token.slice(dot + 1)
  if (!/^[0-9a-f]{8}$/.test(checksum) || payload.length === 0 || payload.includes('.')) {
    return { ok: false, reason: 'malformed' }
  }

  let text: string
  try {
    text = fromBase64Url(payload)
  } catch {
    // 常见于链接被截断：base64 长度非法或字符表被破坏。
    return { ok: false, reason: 'malformed' }
  }

  let candidate: unknown
  try {
    candidate = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (!candidate || typeof candidate !== 'object') {
    return { ok: false, reason: 'malformed' }
  }
  const envelope = candidate as Partial<ShareEnvelope>
  if (typeof envelope.v !== 'number') {
    return { ok: false, reason: 'malformed' }
  }

  // 结构能解析但校验和不符：内容在生成后被改动过。
  if (fnv1aHex(payload) !== checksum) {
    return { ok: false, reason: 'tampered', expiresAt: typeof envelope.e === 'number' ? envelope.e : null }
  }
  if (envelope.v !== ENVELOPE_VERSION) {
    return { ok: false, reason: 'unsupported' }
  }
  if (!isFiniteInteger(envelope.i) || envelope.i <= 0 || !(envelope.e === null || isFiniteInteger(envelope.e))) {
    return { ok: false, reason: 'invalid' }
  }

  const document = expandDocument(envelope.d)
  if (!document) {
    return { ok: false, reason: 'invalid' }
  }
  if (envelope.e !== null && envelope.e <= now) {
    return { ok: false, reason: 'expired', expiresAt: envelope.e }
  }
  return { ok: true, document, createdAt: envelope.i, expiresAt: envelope.e }
}

/** 从 location.hash 中取出分享 token；没有或为空时返回 null（按普通本地工作区处理）。 */
export function readShareToken(hash: string): string | null {
  if (!hash || hash.charAt(0) !== '#') return null
  try {
    const params = new URLSearchParams(hash.slice(1))
    const token = params.get(SHARE_HASH_PARAM)
    return token ? token : null
  } catch {
    return null
  }
}

/** 用当前页面地址拼出完整的分享链接。 */
export function buildShareUrl(token: string, base: { origin: string; pathname: string; search: string } = window.location): string {
  return `${base.origin}${base.pathname}${base.search}#${SHARE_HASH_PARAM}=${encodeURIComponent(token)}`
}

export function formatShareDateTime(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function compactTokens(tokens: BrandTokens): CompactTokens {
  return { p: tokens.primary, s: tokens.secondary, r: tokens.radiusScale, sp: tokens.spacingScale, ty: tokens.typeScale }
}

function compactDocument(document: BrandDocument): CompactDocument {
  return {
    h: document.theme,
    t: compactTokens(document.tokens),
    vs: document.versions.map((version: SavedVersion) => ({
      i: version.id,
      l: version.label,
      c: version.createdAt,
      t: compactTokens(version.tokens),
    })),
  }
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return isFiniteInteger(value) && value >= min && value <= max
}

function expandTokens(value: unknown): BrandTokens | null {
  if (!value || typeof value !== 'object') return null
  const c = value as Partial<CompactTokens>
  if (typeof c.p !== 'string' || typeof c.s !== 'string') return null
  if (!Array.isArray(c.r) || !Array.isArray(c.sp) || !Array.isArray(c.ty)) return null
  if (c.r.length !== 4 || c.sp.length !== 5 || c.ty.length !== 6) return null
  if (!c.r.every((n) => isIntegerInRange(n, 0, 40))) return null
  if (!c.sp.every((n) => isIntegerInRange(n, 2, 64))) return null
  if (!c.ty.every((n) => isIntegerInRange(n, 10, 72))) return null
  // 颜色正则与领域规则保持一致（#RRGGBB）。
  if (!/^#[0-9A-F]{6}$/i.test(c.p) || !/^#[0-9A-F]{6}$/i.test(c.s)) return null
  return { primary: c.p.toUpperCase(), secondary: c.s.toUpperCase(), radiusScale: c.r, spacingScale: c.sp, typeScale: c.ty }
}

function expandDocument(value: unknown): BrandDocument | null {
  if (!value || typeof value !== 'object') return null
  const c = value as Partial<CompactDocument>
  if (typeof c.h !== 'string' || !THEMES.includes(c.h as BrandTheme)) return null
  const tokens = expandTokens(c.t)
  if (!tokens) return null
  if (!Array.isArray(c.vs) || c.vs.length > 50) return null
  const versions: SavedVersion[] = []
  for (const version of c.vs) {
    const versionTokens = expandTokens(version?.t)
    if (!versionTokens) return null
    if (typeof version.i !== 'string' || typeof version.l !== 'string' || typeof version.c !== 'string') return null
    if (!version.i || !version.l || Number.isNaN(Date.parse(version.c))) return null
    versions.push({ id: version.i, label: version.l, createdAt: version.c, tokens: versionTokens })
  }
  return { version: 1, theme: c.h as BrandTheme, tokens, versions }
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(payload: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) throw new Error('非法的 base64url 字符')
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** FNV-1a 32 位哈希，输出 8 位十六进制。输入仅含 base64url 的 ASCII 字符。 */
function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
