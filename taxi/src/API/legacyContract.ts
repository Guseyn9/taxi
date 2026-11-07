/** JSON contracts verified against the supplied Universal API. */
export function offerBookingOptions(price: unknown) {
  const amount = Number(price)
  if (price === '' || !Number.isFinite(amount) || amount <= 0) throw new Error('Offer price must be positive')
  return { customer_price: amount, offer_mode: 'OFFER' }
}

export function bookingOptionAssignment(key: string, value: unknown) {
  return [['=', [key], value]]
}

export function performerOptions(price?: number, eta?: string, comment?: string) {
  return {
    ...(price !== undefined ? { performers_price: price } : {}),
    ...(eta?.trim() ? { driver_offer_eta: eta.trim().slice(0, 120) } : {}),
    ...(comment?.trim() ? { driver_offer_comment: comment.trim().slice(0, 500) } : {}),
  }
}
