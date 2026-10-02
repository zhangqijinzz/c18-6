import { describe, expect, it } from 'vitest'
import { buildShareUrl, createShareToken, decodeShareToken, readShareToken } from '../services/shareService'
import { INITIAL_TOKENS, type BrandDocument } from '../models/brandMirrorModels'

const NOW = new Date('2026-10-02T08:00:00.000Z').getTime()
const DAY = 24 * 60 * 60 * 1000

function makeDocument(overrides: Partial<BrandDocument> = {}): BrandDocument {
  return {
    version: 1,
    theme: 'studio',
    tokens: { ...INITIAL_TOKENS, radiusScale: [...INITIAL_TOKENS.radiusScale], spacingScale: [...INITIAL_TOKENS.spacingScale], typeScale: [...INITIAL_TOKENS.typeScale] },
    versions: [
      { id: 'version-1', label: 'Version A', createdAt: '2026-09-01T00:00:00.000Z', tokens: { ...INITIAL_TOKENS, primary: '#123456', radiusScale: [2, 4, 6, 8], spacingScale: [4, 8, 12, 16, 24], typeScale: [12, 14, 16, 20, 28, 40] } },
    ],
    ...overrides,
  }
}

describe('shareService 编码/解码往返', () => {
  it('冻结的文档可以完整还原，包括版本与中文内容', () => {
    const document = makeDocument()
    const token = createShareToken(document, { ttlDays: 30, now: NOW })
    const result = decodeShareToken(token, NOW)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document).toEqual(document)
    expect(result.createdAt).toBe(NOW)
    expect(result.expiresAt).toBe(NOW + 30 * DAY)
  })

  it('永久链接的 expiresAt 为 null，任意时间都可打开', () => {
    const token = createShareToken(makeDocument(), { ttlDays: null, now: NOW })
    const result = decodeShareToken(token, NOW + 365 * DAY)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.expiresAt).toBeNull()
  })

  it('默认有效期为 30 天', () => {
    const token = createShareToken(makeDocument(), { now: NOW })
    const result = decodeShareToken(token, NOW)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.expiresAt).toBe(NOW + 30 * DAY)
  })
})

describe('shareService 损坏与过期处理', () => {
  const token = createShareToken(makeDocument(), { ttlDays: 7, now: NOW })

  it('到期后返回 expired，而不是渲染旧值', () => {
    const expired = decodeShareToken(token, NOW + 7 * DAY + 1)
    expect(expired.ok).toBe(false)
    if (!expired.ok) {
      expect(expired.reason).toBe('expired')
      expect(expired.expiresAt).toBe(NOW + 7 * DAY)
    }
    // 恰好到期时刻仍可用（exp > now）。
    const onTheEdge = decodeShareToken(token, NOW + 7 * DAY - 1)
    expect(onTheEdge.ok).toBe(true)
  })

  it('截断 token（少一截）判定为 malformed', () => {
    expect(decodeShareToken(token.slice(0, 30), NOW)).toMatchObject({ ok: false, reason: 'malformed' })
    expect(decodeShareToken(token.slice(0, token.length - 8), NOW)).toMatchObject({ ok: false, reason: 'malformed' })
  })

  it('空 token、缺少分隔符、乱码字符都判定为 malformed', () => {
    expect(decodeShareToken('', NOW)).toMatchObject({ ok: false, reason: 'malformed' })
    expect(decodeShareToken('not-a-token', NOW)).toMatchObject({ ok: false, reason: 'malformed' })
    expect(decodeShareToken('abcd1234.payload!bad', NOW)).toMatchObject({ ok: false, reason: 'malformed' })
  })

  it('内容被改动但结构仍可解析时判定为 tampered', () => {
    const [checksum, payload] = token.split('.')
    // 解码、篡改一个字节再编码，保持长度与格式合法。
    const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))))
    json.d.t.p = '#000000'
    const tamperedPayload = btoa(JSON.stringify(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const result = decodeShareToken(`${checksum}.${tamperedPayload}`, NOW)
    expect(result).toMatchObject({ ok: false, reason: 'tampered' })
    // 原始 token 仍完好。
    expect(decodeShareToken(token, NOW).ok).toBe(true)
  })

  it('令牌数量不全或颜色非法的快照判定为 invalid，不显示错值', () => {
    const broken = makeDocument({ tokens: { ...INITIAL_TOKENS, radiusScale: [1, 2], spacingScale: [...INITIAL_TOKENS.spacingScale], typeScale: [...INITIAL_TOKENS.typeScale] } })
    expect(() => createShareToken(broken)).toThrow()
  })

  it('越界数值无法通过校验', () => {
    const document = makeDocument()
    const tokenNow = createShareToken(document, { now: NOW })
    const [, payload] = tokenNow.split('.')
    const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))))
    json.d.t.ty[0] = 999
    const checksum = '00000000'
    const badPayload = btoa(JSON.stringify(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    // 校验和会先失败；即使伪造者重算校验和，数值范围校验仍应拒绝。
    const withFixedChecksum = `${fnvLike(badPayload)}.${badPayload}`
    expect(decodeShareToken(withFixedChecksum, NOW)).toMatchObject({ ok: false, reason: 'invalid' })
    expect(checksum).toBe('00000000')
  })

  it('无法识别的信封版本判定为 unsupported', () => {
    const [, payload] = token.split('.')
    const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))))
    json.v = 99
    const newPayload = btoa(JSON.stringify(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(decodeShareToken(`${fnvLike(newPayload)}.${newPayload}`, NOW)).toMatchObject({ ok: false, reason: 'unsupported' })
  })
})

describe('shareService URL 读写', () => {
  it('从 hash 中读取 token，忽略其他参数', () => {
    expect(readShareToken('#share=abc.def')).toBe('abc.def')
    expect(readShareToken('#other=1&share=tok.123')).toBe('tok.123')
    expect(readShareToken('')).toBeNull()
    expect(readShareToken('#share=')).toBeNull()
    expect(readShareToken('#foo=bar')).toBeNull()
  })

  it('构建的链接把 token 放在 hash 中，刷新不丢失', () => {
    const url = buildShareUrl('ab/cd.ef_', { origin: 'https://brand.local', pathname: '/lab/', search: '' })
    expect(url.startsWith('https://brand.local/lab/#share=')).toBe(true)
    // 特殊字符被百分号编码，URLSearchParams 可还原。
    const encoded = url.split('#share=')[1]
    expect(readShareToken(`#share=${encoded}`)).toBe('ab/cd.ef_')
  })
})

// 测试辅助：复刻 FNV-1a，用于模拟「攻击者重算校验和」的场景。
function fnvLike(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
