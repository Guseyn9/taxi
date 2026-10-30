import {displayFare,orderCurrency} from '../../../design/reliability/rideData'
import React from 'react'
import { t, TRANSLATION } from '../../../localization'
import { CURRENCY } from '../../../siteConstants'
import { formatCurrency, getPayment } from '../../../tools/utils'
import OrderField from './OrderField'
import { EPaymentWays, IOrder } from '../../../types/types'
import images from '../../../constants/images'

interface IProps {
  order: IOrder
}

const Payment: React.FC<IProps> = ({ order }) => {
  const payment=getPayment(order)
  const _type = order.b_payment_way === EPaymentWays.Credit ? TRANSLATION.CARD : TRANSLATION.CASH
  const _value = `${t(_type)} · ${displayFare(payment.value,orderCurrency(order,CURRENCY.NAME),undefined,payment.estimated)}`

  return <div className="order-info__payment">
    <OrderField image={images.cash} alt={t(TRANSLATION.CARD)} title={t(TRANSLATION.PAYMENT_WAY)} value={_value}/>
    {typeof order.profit === 'number' && (
      <OrderField
        image={images.mapMarkerProfit}
        alt={t(TRANSLATION.DRIVER_PROFIT)}
        title={t(TRANSLATION.DRIVER_PROFIT)}
        value={formatCurrency(order.profit, { signDisplay: 'always' })}
      />
    )}
  </div>
}

export default Payment