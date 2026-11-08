import {useEffect, useRef, useState} from 'react'
import type {IOrder} from '../../types/types'
import {terminalBooking} from '../../design/reliability/rideData'
import {registerReadChannel} from '../../diagnostics/readChannels'

/** Absence from a list is not a terminal acknowledgement for a known trip. */
export function useRetainedOrder(owner: unknown, id: IOrder['b_id'] | null,
  orders: IOrder[] | null, read: (id: IOrder['b_id']) => Promise<IOrder | null>) {
  const scope = owner != null && id != null ? `${owner}:${id}` : ''
  const last = useRef<{scope: string; order: IOrder | null}>({scope: '', order: null})
  const [detail, setDetail] = useState<{scope: string; order: IOrder} | null>(null)
  if (last.current.scope !== scope) last.current = {scope, order: null}
  const listed = orders?.find(order => String(order.b_id) === String(id))
  const current = listed || (detail?.scope === scope ? detail.order : null)
  if (current) last.current.order = current
  const snapshot = scope ? last.current.order : null
  useEffect(() => {
    if (!scope || id == null || listed) return
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined
    const health = registerReadChannel()
    const poll = async () => {
      health.start()
      try {
        const order = await read(id)
        if (!order || String(order.b_id) !== String(id) ||
          (order.u_id != null && String(order.u_id) !== String(owner))) throw new Error('Order read was not confirmed')
        if (!stopped) {health.success(); setDetail({scope, order})}
      } catch {if (!stopped) health.failure()}
      finally {if (!stopped) timer = setTimeout(poll, 5000)}
    }
    void poll()
    return () => {stopped = true; clearTimeout(timer); health.dispose()}
  }, [scope, id, listed, owner, read])
  return {order: snapshot && !terminalBooking(snapshot) ? snapshot : null,
    terminal: Boolean(snapshot && terminalBooking(snapshot))}
}
