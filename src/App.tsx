import { BrandMirrorPage } from './features/brand-mirror/views/BrandMirrorPage'
import { BrandMirrorViewModel } from './features/brand-mirror/viewmodels/brandMirrorViewModel'
import { LocalBrandRepository } from './features/brand-mirror/repositories/brandRepository'
import { LocalStorageService } from './features/brand-mirror/services/storageService'
import { BrowserBrandGuidelinesExporter } from './features/brand-mirror/services/exportService'
import { readShareToken } from './features/brand-mirror/services/shareService'

const viewModel = new BrandMirrorViewModel(new LocalBrandRepository(new LocalStorageService()), new BrowserBrandGuidelinesExporter())

// 分享内容只放在 URL hash 中：不经过服务器，也不会出现在请求里。
const shareToken = readShareToken(window.location.hash)

// 退出分享时清掉地址栏中的分享内容，然后由 ViewModel 加载本地工作区（只读、绝不覆盖）。
function exitShareMode(): void {
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
  viewModel.exitShareMode()
}

export default function App() {
  return <BrandMirrorPage viewModel={viewModel} shareToken={shareToken} onExitShare={exitShareMode} />
}
