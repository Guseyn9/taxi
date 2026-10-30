import React from 'react'
import { UserRound } from 'lucide-react'
import { t, TRANSLATION } from '../../localization'
import { EBookingStates, IOrder, IUser } from '../../types/types'

interface IProps {
  order: IOrder,
  client: IUser | null,
  user: IUser | null
}

const ClientInfo: React.FC<IProps> = ({
  order,
  client,
  user,
}) => {
  const _userName = [client?.u_name, client?.u_family, client?.u_middle].filter(Boolean).join(' ') || t(TRANSLATION.PASSENGER),
    _driver = !!user && order?.drivers?.find(item => item.u_id === user.u_id),
    _extInfo =
    order.b_canceled || order.b_state === EBookingStates.Canceled ?
      `(${t(TRANSLATION.CANCELED)})` :
      order.b_completed || order.b_state === EBookingStates.Completed ?
        `(${t(TRANSLATION.FINISHED)})` :
        _driver ?
          `(${t(TRANSLATION.BOOKING_DRIVER_STATES[_driver.c_state])})` :
          ''

  return <div className="order__passenger-info">
    <div className="order_passenger-info">
      <div className="order-passenger-avatar"><UserRound size={28} aria-hidden="true" /></div>
      <span>
        <span className="colored">{_userName} {_extInfo}</span>
      </span>
    </div>
    <div className="order__separator"/>
  </div>
}

export default ClientInfo