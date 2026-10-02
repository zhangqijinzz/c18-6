import { useEffect, useState } from 'react'
import type { BrandMirrorSnapshot, SharedWorkspace } from '../models/brandMirrorModels'
import { BrandMirrorViewModel } from '../viewmodels/brandMirrorViewModel'

interface UseBrandMirrorViewModelOptions {
  sharedWorkspace?: SharedWorkspace | null
  shareNotice?: string | null
}

export function useBrandMirrorViewModel(viewModel: BrandMirrorViewModel, { sharedWorkspace = null, shareNotice = null }: UseBrandMirrorViewModelOptions = {}): BrandMirrorSnapshot {
  const [snapshot, setSnapshot] = useState(viewModel.getSnapshot())
  useEffect(() => {
    const unsubscribe = viewModel.subscribe(() => setSnapshot(viewModel.getSnapshot()))
    if (sharedWorkspace) {
      viewModel.initializeSharedWorkspace(sharedWorkspace)
    } else {
      viewModel.initialize()
      if (shareNotice) viewModel.showShareNotice(shareNotice)
    }
    return unsubscribe
  }, [viewModel, sharedWorkspace, shareNotice])
  return snapshot
}
