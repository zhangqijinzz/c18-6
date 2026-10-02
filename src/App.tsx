import { useMemo } from 'react'
import { BrandMirrorPage } from './features/brand-mirror/views/BrandMirrorPage'
import { LocalBrandRepository, ReadOnlyBrandRepository } from './features/brand-mirror/repositories/brandRepository'
import { LocalStorageService } from './features/brand-mirror/services/storageService'
import { BrowserBrandGuidelinesExporter } from './features/brand-mirror/services/exportService'
import { BrowserShareLinkService } from './features/brand-mirror/services/shareLinkService'
import { BrandMirrorViewModel } from './features/brand-mirror/viewmodels/brandMirrorViewModel'
import type { SharedWorkspace } from './features/brand-mirror/models/brandMirrorModels'

type Bootstrap = {
  viewModel: BrandMirrorViewModel
  sharedWorkspace: SharedWorkspace | null
  shareNotice: string | null
}

export default function App() {
  const bootstrap = useMemo<Bootstrap>(() => {
    const shareLinks = new BrowserShareLinkService()
    const parsed = shareLinks.parseHash(window.location.hash)

    if (parsed.status === 'valid') {
      return {
        viewModel: new BrandMirrorViewModel(new ReadOnlyBrandRepository(), new BrowserBrandGuidelinesExporter(), shareLinks),
        sharedWorkspace: parsed.workspace,
        shareNotice: null,
      }
    }

    const hadShareHash = window.location.hash.startsWith('#/share/')
    if (hadShareHash) {
      shareLinks.clearShareHash()
    }

    return {
      viewModel: new BrandMirrorViewModel(new LocalBrandRepository(new LocalStorageService()), new BrowserBrandGuidelinesExporter(), shareLinks),
      sharedWorkspace: null,
      shareNotice: hadShareHash ? parsed.message : null,
    }
  }, [])

  return <BrandMirrorPage viewModel={bootstrap.viewModel} sharedWorkspace={bootstrap.sharedWorkspace} shareNotice={bootstrap.shareNotice} />
}
