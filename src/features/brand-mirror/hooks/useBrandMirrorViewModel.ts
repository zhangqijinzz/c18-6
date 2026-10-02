import { useEffect, useState } from 'react'
import type { BrandMirrorSnapshot } from '../models/brandMirrorModels'
import { BrandMirrorViewModel } from '../viewmodels/brandMirrorViewModel'

export function useBrandMirrorViewModel(viewModel: BrandMirrorViewModel, shareToken?: string | null): BrandMirrorSnapshot {
  const [snapshot, setSnapshot] = useState(viewModel.getSnapshot())
  useEffect(() => {
    const unsubscribe = viewModel.subscribe(() => setSnapshot(viewModel.getSnapshot()))
    viewModel.initialize(shareToken)
    return unsubscribe
  }, [viewModel, shareToken])
  return snapshot
}
