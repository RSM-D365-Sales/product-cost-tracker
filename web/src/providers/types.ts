import type {
  ItemInfo,
  ProductCostQuery,
  ProductCostResult,
  ProviderKind,
  Ref,
} from '../types/domain'
import type {
  ProductionCostQuery,
  ProductionCostResult,
} from '../types/production'

/**
 * The single seam between the UI and the data source.
 *
 * Every method takes an AbortSignal so the UI can cancel in-flight work when
 * the user re-runs the inquiry — F&O users hammer the Run button.
 */
export interface ProductCostProvider {
  readonly kind: ProviderKind
  /** Shown in the status bar so it's obvious which source a demo is running on. */
  readonly label: string

  /** The main inquiry. Throws ProviderError on failure. */
  getProductCostInquiry(
    query: ProductCostQuery,
    signal?: AbortSignal,
  ): Promise<ProductCostResult>

  /**
   * The production cost inquiry: costed BOM and route, on-hand lots with their
   * expiry dates, and a FEFO production plan costed at the actual cost of the
   * lots it consumes.
   *
   * Only the mock provider implements this today — see the note in
   * lib/odataConfig.ts on which entities a live implementation would need and
   * why they have not been guessed at.
   */
  getProductionCostInquiry(
    query: ProductionCostQuery,
    signal?: AbortSignal,
  ): Promise<ProductionCostResult>

  /** Released products with a bill of material — the produced items only. */
  lookupProducedItems(term: string, signal?: AbortSignal): Promise<ItemInfo[]>

  lookupItems(term: string, signal?: AbortSignal): Promise<ItemInfo[]>
  lookupSites(term: string, signal?: AbortSignal): Promise<Ref[]>
  lookupWarehouses(
    siteId: string | undefined,
    term: string,
    signal?: AbortSignal,
  ): Promise<Ref[]>
  lookupBatches(
    itemNumber: string,
    term: string,
    signal?: AbortSignal,
  ): Promise<Ref[]>
  lookupPurchaseOrders(
    itemNumber: string,
    term: string,
    signal?: AbortSignal,
  ): Promise<Ref[]>
}

/** Carries enough detail to render an F&O-style message bar. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}
