/**
 * Items read live from Dynamics 365 when VITE_DATA_PROVIDER=hybrid.
 *
 * Everything else in the catalogue (data/seed.ts) stays on the seeded demo
 * data; these item numbers are routed to the OData provider instead, so the
 * walkthrough can create a purchase order in Finance and Supply Chain and then
 * pull the same item up here with its real prices, open order lines and
 * receipts.
 *
 * The names below are only what the Item lookup shows before the inquiry runs —
 * so the lookup lists them without a round trip and still works when the proxy
 * is down. Once an item is run, every figure on the page (name, unit, cost,
 * sales price, orders, receipts, charges) comes from the environment.
 *
 * Retargeting at a different environment or item range is an edit to this list
 * and VITE_LIVE_COMPANY in web/.env — nothing else.
 */

export interface LiveItem {
  itemNumber: string
  productName: string
}

export const LIVE_ITEMS: readonly LiveItem[] = [
  { itemNumber: 'FG860', productName: 'Spanish Extra Virgin Olive Oil 36 3oz' },
  { itemNumber: 'FG861', productName: 'Spanish Extra Virgin Olive Oil 9 24 Oz' },
  { itemNumber: 'FG862', productName: 'Spanish Extra Virgin Olive Oil 9 34 Oz' },
  { itemNumber: 'FG863', productName: 'Spanish Olive Oil 25 8.5 Oz' },
  { itemNumber: 'FG864', productName: 'Goya Cans Coconut Water T Pack 24 17.6 OZ' },
  { itemNumber: 'FG865', productName: 'Goya Cans Coconut Water 60 520 ML' },
  { itemNumber: 'FG866', productName: 'Canilla LG Rice 20 lb Pol Pack' },
  { itemNumber: 'FG867', productName: 'Cocktail Pitted Olives 5.5 oz' },
  { itemNumber: 'FG868', productName: 'Organic Spanis Extra Virgin Olive Oil 12 17 Oz' },
  { itemNumber: 'FG869', productName: 'Spanish Olive Oil 12 17 Oz' },
  { itemNumber: 'FG870', productName: 'Spanish Olive Oil PET 9 34 Oz' },
  { itemNumber: 'FG871', productName: 'Spanish Olive Oil Light Glass 25 8.5 Oz' },
  { itemNumber: 'FG872', productName: 'Balsamic Vinegar 9 8.5 Oz' },
  { itemNumber: 'FG873', productName: 'Sherry Vinegar 9 8.5 Oz' },
  { itemNumber: 'FG874', productName: 'Spanish Extra Virgin Olive Oil with Garlic' },
  { itemNumber: 'FG875', productName: 'Extra Virgin Olive Oil Spray' },
  { itemNumber: 'FG876', productName: 'Avocado Oil' },
  { itemNumber: 'FG877', productName: 'Manzanilla Olives "Organics"' },
  { itemNumber: 'FG878', productName: 'Manz. Olives Broken w Pimento' },
]

const LIVE_SET = new Set(LIVE_ITEMS.map((i) => i.itemNumber.toLowerCase()))

/** True for an item number that is read from Dynamics 365 rather than the seed. */
export function isLiveItem(itemNumber: string): boolean {
  return LIVE_SET.has(itemNumber.trim().toLowerCase())
}
