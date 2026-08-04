import { useMemo } from 'react'
import { createProvider } from './providers'
import { useHashRoute } from './lib/route'
import { ProductCostInquiry } from './pages/ProductCostInquiry'
import { ProductionCostInquiry } from './pages/ProductionCostInquiry'

export default function App() {
  // Built once. Swapping providers is an .env change, not a code change.
  const provider = useMemo(() => createProvider(), [])
  const { pageId, params, navigate } = useHashRoute()
  const item = params.get('item') ?? undefined

  // Keyed on the item too: arriving from the other page with a different item
  // in the hash has to reset the form, not leave the previous one sitting there.
  const key = `${pageId}|${item ?? ''}`

  return pageId === 'production-cost' ? (
    <ProductionCostInquiry
      key={key}
      provider={provider}
      initialItem={item}
      onNavigate={navigate}
    />
  ) : (
    <ProductCostInquiry
      key={key}
      provider={provider}
      initialItem={item}
      onNavigate={navigate}
    />
  )
}
