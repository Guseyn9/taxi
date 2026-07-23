import React, { useMemo } from 'react'
import { useSelector } from 'react-redux'
import { IOrder } from '../../types/types'
import { ordersSelectors } from '../../state/orders'
import { getOrderIdParts } from '../../tools/orderId'
import './styles.scss'

interface IProps {
  orderId?: IOrder['b_id'] | number | null
  /**
   * `full` — полный id с выделенным коротким суффиксом через тире (`12345-67`);
   * `short` — только короткий суффикс (`67`) для плашки карточки заказа.
   */
  variant?: 'full' | 'short'
  /** Показывать ли префикс `№` */
  withSign?: boolean
  className?: string
  style?: React.CSSProperties
}

/**
 * Единый показ id заказа с коротким уникальным суффиксом.
 * Уникальность считается среди активных заказов водителя.
 */
const OrderId: React.FC<IProps> = ({
  orderId,
  variant = 'full',
  withSign = true,
  className,
  style,
}) => {
  const activeOrders = useSelector(ordersSelectors.activeOrders)

  const poolIds = useMemo(
    () => (activeOrders ?? []).map(order => order.b_id),
    [activeOrders],
  )

  const { prefix, suffix } = useMemo(
    () => getOrderIdParts(orderId, poolIds),
    [orderId, poolIds],
  )

  if (!suffix) return null

  return (
    <span className={['order-id', className].filter(Boolean).join(' ')} style={style}>
      {withSign && '№'}
      {variant === 'full' && prefix ? (
        <>
          {prefix}
          <span className="order-id__suffix">-{suffix}</span>
        </>
      ) : (
        <span className="order-id__suffix">{suffix}</span>
      )}
    </span>
  )
}

export default OrderId
