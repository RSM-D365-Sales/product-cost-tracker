# RSM Product cost inquiry — X++ service

Reference implementation of the server-side data layer. Returns every posted
product receipt line for an item with purchase-order charges allocated down to
the line, so the client can present landed cost and margin per receipt.

## Why this rather than standard OData entities

The OData path works and is included in the app, but three things cannot be
resolved correctly from outside F&O:

1. **Header-charge allocation.** A header charge is stored once against the
   order (`MarkupTrans` against `PurchTable`), not per line. Producing a
   per-unit add-on cost means spreading it across every line of the order by the
   order's allocation method, then prorating the receiving line's share by how
   much of the ordered quantity that receipt covered. Doing that outside F&O
   means re-implementing it and keeping it in step.
2. **Financial vs. stock charges.** Whether a charge is expensed or capitalised
   into inventory value is a property of the charge code's debit posting type.
   That is not exposed on the OData charge entities.
3. **Net-weight allocation.** Needs the item's weight, which the purchase order
   line entity does not expose either.

It also collapses four round trips into one.

## Files

| File                                | Purpose                                              |
| ----------------------------------- | ---------------------------------------------------- |
| `RSMProductCostInquiryService.xpp`  | The service. Query, join, allocation, classification. |
| `RSMProductCostQueryContract.xpp`   | Request: item + optional filters + date window.       |
| `RSMProductCostResultContract.xpp`  | Response: item, rows, warnings.                       |
| `RSMProductCostItemContract.xpp`    | Item header for the Summary block.                    |
| `RSMProductCostLineContract.xpp`    | One receipt line.                                     |
| `RSMProductCostChargeContract.xpp`  | One allocated charge.                                 |

The contracts serialise into exactly the shape consumed by
[`web/src/providers/serviceProvider.ts`](../web/src/providers/serviceProvider.ts).

Landed cost and margin are deliberately **not** returned. The service supplies
the raw parts — FOB price and allocated charges — and the client derives the
derived figures, so there is one definition of the formula rather than two that
can disagree.

## Before you compile

A handful of member and enum names vary between application versions. Each is
marked with a `VERIFY` comment in the source. They are:

| Location             | What to check                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `getProductCost`     | `VendPackingSlipJour.InternalPackingSlipId` on the join — drop the clause if not present.      |
| `allocationBasis`    | `MarkupAllocation` enum literals (`Net`, `Qty`, `Pcs`, `Weight`). The default branch is safe.  |
| `chargeTypeOf`       | `MarkupTable.PostingType` against `MarkupPosting::Item` — the "Debit type = Item" setting.     |
| `buildItemContract`  | Cost source. Uses `InventTableModule` base price; swap for `InventItemPrice::findActive` if you run standard cost. |

Everything else uses stable, long-standing members.

## Deploying

1. Create a package/model in Visual Studio with the Dynamics 365 tools.
2. Add the six classes above.
3. Create a **service** `RSMProductCostInquiryService` exposing the
   `getProductCost` method, and a **service group**
   `RSMProductCostServiceGroup` containing it. Set the service group's
   *AutoDeploy* to `Yes`.
4. Build, sync, and deploy.

The endpoint is then:

```
POST https://<env>/api/services/RSMProductCostServiceGroup/RSMProductCostInquiryService/getProductCost
Content-Type: application/json
Authorization: Bearer <token>

{ "_request": { "itemNumber": "F440", "daysBack": 365, "company": "USMF" } }
```

Point the proxy at it and switch the client over:

```
# server/.env
D365_SERVICE_PATH=RSMProductCostServiceGroup/RSMProductCostInquiryService/getProductCost
D365_SERVICE_PARAM=_request

# web/.env
VITE_DATA_PROVIDER=service
```

`D365_SERVICE_PARAM` must match the X++ parameter name (`_request`) — the JSON
body keys the contract by parameter name, not by position.

## Performance

The receipt-line query is driven by `VendPackingSlipTrans.ItemId`, joined to
`PurchLine` on `InventTransId`. Header-charge allocation runs **once per
purchase order**, not once per receipt line, cached in a `Map` keyed by
`PurchLine.RecId`.

For a high-volume item over a wide date range, consider adding an index on
`VendPackingSlipTrans (ItemId, DataAreaId)` if one is not already effective, and
encourage users to supply a date window — the parameters panel defaults to none.
