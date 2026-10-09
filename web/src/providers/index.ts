import type { ProviderKind } from '../types/domain'
import type { ProductCostProvider } from './types'
import { mockProvider } from './mockProvider'
import { createODataProvider } from './odataProvider'
import { createServiceProvider } from './serviceProvider'
import { createHybridProvider } from './hybridProvider'

/**
 * The one place the data source is chosen. Set VITE_DATA_PROVIDER in .env
 * (mock | odata | service | hybrid) — nothing else in the app changes.
 */
export function createProvider(
  kind: ProviderKind = (import.meta.env.VITE_DATA_PROVIDER ??
    'mock') as ProviderKind,
): ProductCostProvider {
  switch (kind) {
    case 'hybrid':
      return createHybridProvider()
    case 'odata':
      return createODataProvider()
    case 'service':
      return createServiceProvider()
    case 'mock':
    default:
      return mockProvider
  }
}

export type { ProductCostProvider }
