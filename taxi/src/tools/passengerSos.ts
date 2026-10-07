/**
 * Backend отвечает на бизнес-ошибку (например «wrong booking state») HTTP 200 с
 * `status: "error"` в теле, а `ordersActionCreators.cancel` в этом случае не
 * бросает исключение, а возвращает ответ. Успех — только `code 200` без
 * `status: "error"`.
 */
export const isCancelSucceeded = (result: unknown) => {
  const response = result as { code?: unknown, status?: unknown } | null | undefined
  return String(response?.code) === '200' && response?.status !== 'error'
}

/**
 * Отправить Passenger SOS: существующий `set_cancel_state` с выбранной причиной.
 * Бросает и при сетевой ошибке, и при бизнес-ошибке backend — вызывающий код
 * переводит UI в «Canceled» только после возврата без исключения.
 */
export async function submitPassengerSos<TOrderId>(
  cancelOrder: (orderId: TOrderId, reason: string) => Promise<unknown>,
  orderId: TOrderId,
  reasonLabel: string,
) {
  const result = await cancelOrder(orderId, reasonLabel)
  if (!isCancelSucceeded(result))
    throw new Error(`set_cancel_state rejected: ${JSON.stringify(result)}`)

  return result
}
