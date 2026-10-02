import { useEffect, useMemo, useState } from 'react'
import type { BrandDocument, BrandMirrorSnapshot } from '../models/brandMirrorModels'
import { buildShareUrl, createShareToken, formatShareDateTime } from '../services/shareService'

interface ShareDialogProps {
  open: boolean
  snapshot: BrandMirrorSnapshot
  onClose: () => void
}

const TTL_OPTIONS: { value: number | null; label: string }[] = [
  { value: 7, label: '7 天' },
  { value: 30, label: '30 天' },
  { value: 90, label: '90 天' },
  { value: null, label: '永久' },
]

type ShareLink = { url: string; permanent: boolean } | { error: string }

export function ShareDialog({ open, snapshot, onClose }: ShareDialogProps) {
  const [ttlDays, setTtlDays] = useState<number | null>(30)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  const link: ShareLink = useMemo(() => {
    if (!open) return { error: '' }
    try {
      const document: BrandDocument = { version: 1, tokens: snapshot.tokens, theme: snapshot.theme, versions: snapshot.versions }
      return { url: buildShareUrl(createShareToken(document, { ttlDays })), permanent: ttlDays === null }
    } catch (error) {
      return { error: error instanceof Error ? error.message : '当前工作区状态无法生成分享链接' }
    }
  }, [open, snapshot, ttlDays])

  // 切换有效期或重新打开时，重新显示复制按钮。
  useEffect(() => {
    setCopyState('idle')
  }, [ttlDays, open])

  if (!open) return null

  const handleCopy = async () => {
    if (!('url' in link)) return
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link.url)
      } else {
        const input = document.createElement('textarea')
        input.value = link.url
        input.style.position = 'fixed'
        input.style.opacity = '0'
        document.body.appendChild(input)
        input.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(input)
        if (!ok) throw new Error('copy failed')
      }
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-dialog-title">
        <div className="share-dialog-head">
          <div>
            <span className="eyebrow">SHARE / READ-ONLY</span>
            <h2 id="share-dialog-title">分享只读工作区</h2>
          </div>
          <button className="text-button" type="button" onClick={onClose} aria-label="关闭分享对话框">关闭 ×</button>
        </div>

        {'error' in link && link.error ? (
          <p className="share-dialog-error">{link.error}</p>
        ) : 'url' in link ? (
          <>
            <p className="share-dialog-note">
              链接会冻结此刻的<strong>令牌、版本与样例</strong>。对方打开后只能查看，不能修改；链接不会写入或覆盖对方本地的工作区。
            </p>
            <div className="share-ttl" role="radiogroup" aria-label="链接有效期">
              {TTL_OPTIONS.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  role="radio"
                  aria-checked={ttlDays === option.value}
                  className={ttlDays === option.value ? 'active' : ''}
                  onClick={() => setTtlDays(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <label className="share-link-field">
              <span>分享链接</span>
              <input readOnly aria-label="只读分享链接" value={link.url} onFocus={(event) => event.target.select()} />
            </label>
            <div className="share-dialog-footer">
              <small>
                生成时间 {formatShareDateTime(Date.now())} · {link.permanent ? '链接永久有效' : '到期后自动失效，打开时会看到过期提示'}
              </small>
              <button className="primary-button" type="button" onClick={handleCopy}>
                {copyState === 'copied' ? '✓ 已复制链接' : copyState === 'failed' ? '复制失败，请手动选择复制' : '复制链接'}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
