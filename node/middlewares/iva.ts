import { json } from 'co-body'

interface CheckoutItem {
  id: string
  sku?: string
  productId?: string
  ean?: string
  refId?: string
  categoryId?: string
  unitMultiplier?: number
  measurementUnit?: string
  targetPrice?: number
  itemPrice?: number
  quantity?: number
  discountPrice?: number
  dockId?: string
  freightPrice?: number
  brandId?: string
  taxCode?: string
  sellerId?: string
  shippingDestinationId?: number
}

interface Total {
  id: string
  name?: string
  value: number
}

interface ShippingDestination {
  id?: number
  country?: string
  state?: string
  city?: string
  neighborhood?: string
  postalCode?: string
  street?: string
}

interface CheckoutPayload {
  orderFormId?: string
  salesChannel?: string
  items?: CheckoutItem[]
  totals?: Total[]
  shippingDestination?: ShippingDestination
  shippingDestinations?: ShippingDestination[]
}

interface TaxDetail {
  name: string
  description: string
  value: number
}

interface TaxResponse {
  id: string
  taxes: TaxDetail[]
}

const IVA_RATE = 0.19
const IVA_DIVISOR = 1 + IVA_RATE
const SAN_ANDRES_POSTAL_CODES = ['88001', '88564']

function implicitIva(grossValue: number): number {
  if (!grossValue || grossValue <= 0) return 0
  return Math.round(grossValue - grossValue / IVA_DIVISOR)
}

function getTotalValue(totals: Total[] = [], id: string): number {
  const total = totals.find((t) => t.id === id)
  return Number(total?.value || 0)
}

function normalizePostalCode(postalCode?: string): string {
  return String(postalCode || '').replace(/\D/g, '')
}

function isSanAndresProvidencia(
  shippingDestination?: ShippingDestination
): boolean {
  if (!shippingDestination) return false

  return SAN_ANDRES_POSTAL_CODES.includes(
    normalizePostalCode(shippingDestination.postalCode)
  )
}

function safeNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export async function calculateIva(ctx: Context, next: () => Promise<any>) {
  try {
    const body = (await json(ctx.req)) as CheckoutPayload

    console.log('========== TAX REQUEST ==========')
    console.log(JSON.stringify(body, null, 2))

    const items = body.items || []
    const totals = body.totals || []
    const shippingDestination = body.shippingDestination || body.shippingDestinations?.[0]

    const appliesExemption = isSanAndresProvidencia(shippingDestination)

    console.log('================== DEBUG TAX SERVICE ==================')
console.log('Body recibido:', JSON.stringify(body, null, 2))
console.log('Totals recibidos:', JSON.stringify(totals, null, 2))
console.log('Items total:', getTotalValue(totals, 'Items'))
console.log('Shipping total:', getTotalValue(totals, 'Shipping'))
console.log('Discounts total:', getTotalValue(totals, 'Discounts'))
console.log('======================================================')
    console.log(
      JSON.stringify(
        {
          orderFormId: body.orderFormId,
          salesChannel: body.salesChannel,
          appliesExemption,
          shippingDestination,
          totals,
        },
        null,
        2
      )
    )

    const itemsTotalFromTotals = getTotalValue(totals, 'Items')
    const shippingTotalFromTotals = getTotalValue(totals, 'Shipping')

    const sumItemsFromPayload = items.reduce((acc, item) => {
      const itemPrice = safeNumber(item.itemPrice)
      const quantity = safeNumber(item.quantity)
      return acc + itemPrice * quantity
    }, 0)

    const useTotalsScale =
      itemsTotalFromTotals > 0 &&
      sumItemsFromPayload > 0 &&
      Math.abs(itemsTotalFromTotals - sumItemsFromPayload * 100) < 1

    console.log('========== TAX CALCULATION BASE ==========')
    console.log(
      JSON.stringify(
        {
          itemsTotalFromTotals,
          shippingTotalFromTotals,
          sumItemsFromPayload,
          useTotalsScale,
        },
        null,
        2
      )
    )
      //const discountsTotalFromTotals = Math.abs(getTotalValue(totals, 'Discounts'))
    const response: TaxResponse[] = items.map((item, index) => {
      
      const quantity = safeNumber(item.quantity)
      const rawItemPrice = safeNumber(item.itemPrice)
      const rawFreightPrice = safeNumber(item.freightPrice)
      const rawDiscountPrice = Math.abs(safeNumber(item.discountPrice))
      const itemGrossBeforeDiscount = rawItemPrice * quantity
      const itemDiscount = rawDiscountPrice * quantity

      const itemGross = itemGrossBeforeDiscount - itemDiscount

      let freightGross = rawFreightPrice

      if (freightGross === 0 && shippingTotalFromTotals > 0 && sumItemsFromPayload > 0) {
        const proportion = itemGross / sumItemsFromPayload
        freightGross = shippingTotalFromTotals * proportion

        if (useTotalsScale) {
          freightGross = freightGross / 100
        }
      }

      const itemIva = appliesExemption ? implicitIva(itemGross) : 0
      const freightIva = appliesExemption ? implicitIva(freightGross) : 0

      const totalNegativeTax = -(itemIva + freightIva)

      console.log(
        JSON.stringify(
          {
             index,
             requestItemId: item.id,
             responseItemId: String(index),
             quantity,
             rawItemPrice,
             rawDiscountPrice,
             rawFreightPrice,
             itemGrossBeforeDiscount,
             itemDiscount,
             itemGross,
             freightGross,
             itemIva,
             freightIva,
             totalNegativeTax,
          },
          null,
          2
        )
      )

      return {
        id: String(index),
        taxes: [
          {
            name: 'AJUSTE IVA SAN ANDRES',
            description:
              'Ajuste negativo correspondiente al IVA implícito de producto y flete.',
            value: totalNegativeTax,
          },
        ],
      }
    })

    console.log('========== TAX RESPONSE ==========')
    console.log(JSON.stringify(response, null, 2))

    ctx.set('Content-Type', 'application/vnd.vtex.checkout.minicart.v1+json')
    ctx.status = 200
    ctx.body = response

    await next()
  } catch (error) {
    console.error('========== TAX ERROR ==========')
    console.error(error)

    ctx.status = 500
    ctx.body = {
      error: 'Error procesando cálculo de impuestos',
      message: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}