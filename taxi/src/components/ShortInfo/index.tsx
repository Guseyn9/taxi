import {displayFare,orderCurrency} from '../../design/reliability/rideData'
import {CURRENCY} from '../../siteConstants'
import React, { useMemo } from 'react'
import moment from 'moment'
import { IOrder } from '../../types/types'
import { connect, ConnectedProps } from 'react-redux'
import cn from 'classnames'
import { getPhoneNumberError, formatCurrency, getPayment } from '../../tools/utils'
import { IRootState } from '../../state'
import { clientOrderSelectors } from '../../state/clientOrder'
import { t, TRANSLATION } from '../../localization'
import Icon from '../Icon'
import './styles.scss'

const mapStateToProps = (state: IRootState) => ({
  time: clientOrderSelectors.time(state),
  seats: clientOrderSelectors.seats(state),
  carClass: clientOrderSelectors.carClass(state),
  customerPrice: clientOrderSelectors.customerPrice(state),
  phone: clientOrderSelectors.phone(state),
})

const connector = connect(mapStateToProps)

interface IProps extends ConnectedProps<typeof connector> {
  orderSnapshot?: IOrder | null
  className?: string
  hideCarClass?: boolean
  showActivityDot?: boolean
  activityCount?: number
  activityLabel?: string
  onActivityClick?: () => void
}

export function ShortInfo({
  time,
  seats,
  carClass,
  customerPrice,
  phone,
  className,
  hideCarClass = false,
  showActivityDot = false,
  activityCount,
  activityLabel,
  onActivityClick,
  orderSnapshot,
}: IProps) {
  const snapshotPayment=orderSnapshot?getPayment(orderSnapshot):null
  const items: {
    name: React.ComponentProps<typeof Icon>['src']
    value: string | null
    active?: boolean
  }[] = [
    // { name: 'carNearby', value: '7 / 5 min' },
    {
      name: 'alarm',
      value: orderSnapshot ? moment(orderSnapshot.b_start_datetime).format('HH:mm') : time === 'now' ? t(TRANSLATION.NOW) : time.format('HH:mm'),
    },
    { name: 'people', value: `${orderSnapshot?.b_passengers_count ?? seats}` },
    { name: 'car', value: hideCarClass ? null : t(TRANSLATION.CAR_CLASSES[orderSnapshot?.b_car_class ?? carClass]) },
    {
      name: 'money',
      value: orderSnapshot ? displayFare(snapshotPayment?.value,orderCurrency(orderSnapshot,CURRENCY.NAME),undefined,snapshotPayment?.estimated) : customerPrice !== null ? formatCurrency(customerPrice) : null,
    },
    {
      name: 'call',
      value: '',
      active: useMemo(() =>
        getPhoneNumberError(phone) === null
      , [phone]),
    },
    { name: 'msg', value: '' },
  ]

  const displayItems = hideCarClass ? items.filter(item => item.value !== null && item.value !== '') : items

  return (
    <div
      className={cn(
        'short-info',
        className,
        { 'short-info--clickable': Boolean(onActivityClick) },
      )}
      onClick={onActivityClick}
      role={onActivityClick ? 'button' : undefined}
      tabIndex={onActivityClick ? 0 : undefined}
      onKeyDown={event => {
        if (!onActivityClick)
          return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onActivityClick()
        }
      }}
    >
      {displayItems.map(({ name, value, active = true }, index) => value !== null &&
        <React.Fragment key={name}>
          <div
            className={cn(
              'short-info__item',
              { 'short-info__item--active': active },
            )}
            data-info-kind={name}
          >
            <Icon className="short-info__icon" src={name} />
            <span className="short-info__text">{value}</span>
          </div>
          {index < displayItems.length - 1 && <div className="short-info__line" />}
        </React.Fragment>,
      )}
      {showActivityDot && (
        <>
          <div className="short-info__line" />
          <div className="short-info__item short-info__item--activity short-info__item--active">
            <span className="short-info__activity-dot">{activityCount ?? ''}</span>
            {activityLabel && <span className="short-info__text">{activityLabel}</span>}
          </div>
        </>
      )}
    </div>
  )
}

export default connector(ShortInfo)