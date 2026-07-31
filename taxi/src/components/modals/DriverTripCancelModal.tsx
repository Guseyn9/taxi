import React, { useEffect, useMemo, useState } from 'react'
import { connect, ConnectedProps } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import cn from 'classnames'
import SITE_CONSTANTS from '../../siteConstants'
import { t, TRANSLATION } from '../../localization'
import { getLocalizedCancelReasons } from '../../tools/cancelReasons'
import { modalsActionCreators, modalsSelectors } from '../../state/modals'
import { ordersSelectors } from '../../state/orders'
import { IRootState } from '../../state'
import { EStatuses } from '../../types/types'
import * as API from '../../API'
import Button from '../Button'
import OrderId from '../OrderId'
import Overlay from './Overlay'
import { getOrderIdText } from '../../tools/orderId'
import './styles.scss'

const mapStateToProps = (state: IRootState) => ({
  modal: modalsSelectors.driverTripCancelModal(state),
  activeOrders: ordersSelectors.activeOrders(state),
})

const mapDispatchToProps = {
  setDriverTripCancelModal: modalsActionCreators.setDriverTripCancelModal,
  setMessageModal: modalsActionCreators.setMessageModal,
}

const connector = connect(mapStateToProps, mapDispatchToProps)

interface IProps extends ConnectedProps<typeof connector> {
}

/**
 * Driver-side counterpart of the passenger cancel-reason picker: interrupting a
 * trip that is already under way must be attributed, so the reason travels to
 * the backend with the cancel request (same `reason` field the passenger uses).
 */
const DriverTripCancelModal: React.FC<IProps> = ({
  modal,
  activeOrders,
  setDriverTripCancelModal,
  setMessageModal,
}) => {
  const navigate = useNavigate()
  const { isOpen, orderId } = modal
  const activeOrderIds = (activeOrders ?? []).map(item => item.b_id)
  const reasons = useMemo(() => getLocalizedCancelReasons(SITE_CONSTANTS.DRIVER_TRIP_CANCEL_REASONS), [isOpen])

  const [reason, setReason] = useState(reasons[0]?.id ?? '0')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setReason(reasons[0]?.id ?? '0')
      setIsSubmitting(false)
    }
  }, [isOpen, reasons])

  const handleClose = () => {
    if (!isSubmitting)
      setDriverTripCancelModal({ isOpen: false })
  }

  const handleConfirm = () => {
    if (isSubmitting || !orderId)
      return

    setIsSubmitting(true)
    API.cancelDrive(orderId, reasons.find(item => item.id === reason)?.label)
      .then(() => {
        setDriverTripCancelModal({ isOpen: false })
        setMessageModal({
          isOpen: true,
          status: EStatuses.Success,
          message: [t(TRANSLATION.DRIVER_TRIP_CANCELLED), getOrderIdText(orderId, activeOrderIds)]
            .filter(Boolean).join(' '),
        })
        navigate('/driver-order')
      })
      .catch(error => {
        console.error(error)
        setIsSubmitting(false)
        setMessageModal({
          isOpen: true,
          status: EStatuses.Fail,
          message: t(TRANSLATION.ERROR),
        })
      })
  }

  return (
    <Overlay
      isOpen={isOpen}
      onClick={handleClose}
    >
      <div className="modal cancel-order-modal message-window">
        <h3>{t(TRANSLATION.DRIVER_TRIP_CANCEL_TITLE)}</h3>
        {!!orderId && (
          <div className="cancel-order-modal__order-id">
            <OrderId orderId={orderId} variant="full" />
          </div>
        )}
        {reasons.map(item => {
          const active = reason === item.id
          return (
            <div
              key={item.id}
              onClick={() => !isSubmitting && setReason(item.id)}
              className={cn('reason-item', { 'reason-item--active': active })}
              style={{ color: active ? SITE_CONSTANTS.PALETTE.primary.dark : undefined }}
            >
              {item.label}
            </div>
          )
        })}
        <div className="modal__buttons-block">
          <Button
            text={isSubmitting ? t(TRANSLATION.LOADING) : t(TRANSLATION.INTERRUPT_TRIP)}
            onClick={handleConfirm}
            disabled={isSubmitting}
          />
          <Button
            text={t(TRANSLATION.CANCEL)}
            onClick={handleClose}
            disabled={isSubmitting}
          />
        </div>
      </div>
    </Overlay>
  )
}

export default connector(DriverTripCancelModal)
