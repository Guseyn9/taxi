import React, { useEffect, useMemo, useRef, useState } from 'react'
import { connect, ConnectedProps } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import cn from 'classnames'
import SITE_CONSTANTS from '../../siteConstants'
import { t, TRANSLATION } from '../../localization'
import { getLocalizedCancelReasons } from '../../tools/cancelReasons'
import { modalsActionCreators, modalsSelectors } from '../../state/modals'
import { ordersSelectors } from '../../state/orders'
import { userSelectors } from '../../state/user'
import { runDriverSelfCancellation } from '../../tools/driverSelfCancel'
import { IRootState } from '../../state'
import { EStatuses } from '../../types/types'
import { driverMapGateway } from '../../platform/adapters/DriverMapGateway'
import Button from '../Button'
import OrderId from '../OrderId'
import Overlay from './Overlay'
import { getApiErrorMessage } from '../../tools/apiMessages'
import { getOrderIdText } from '../../tools/orderId'
import './styles.scss'

const mapStateToProps = (state: IRootState) => ({
  modal: modalsSelectors.driverTripCancelModal(state),
  activeOrders: ordersSelectors.activeOrders(state),
  user: userSelectors.user(state),
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
export const DriverTripCancelModal: React.FC<IProps> = ({
  modal,
  activeOrders,
  user,
  setDriverTripCancelModal,
  setMessageModal,
}) => {
  const navigate = useNavigate()
  const { isOpen, orderId } = modal
  const activeOrderIds = (activeOrders ?? []).map(item => item.b_id)
  const reasons = useMemo(() => getLocalizedCancelReasons(SITE_CONSTANTS.DRIVER_TRIP_CANCEL_REASONS), [isOpen])

  const [reason, setReason] = useState(reasons[0]?.id ?? '0')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)

  useEffect(() => {
    if (isOpen) {
      setReason(reasons[0]?.id ?? '0')
      setError('')
    }
  }, [isOpen, reasons])

  const handleClose = () => {
    if (!pending.current)
      setDriverTripCancelModal({ isOpen: false })
  }

  const handleConfirm = () => {
    if (pending.current || !orderId)
      return

    pending.current = true
    setError('')
    setIsSubmitting(true)
    // Метку ставим до запроса: опрос активных заказов может увидеть отмену
    // раньше, чем вернётся ответ, и показать «Клиент отменил заказ».
    runDriverSelfCancellation(
      orderId,
      user?.u_id,
      () => driverMapGateway.cancel(orderId, reasons.find(item => item.id === reason)?.label),
    )
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
      .catch(failure => {
        setError(getApiErrorMessage(failure, { context: 'driver-order' }))
      })
      .finally(() => {
        pending.current = false
        setIsSubmitting(false)
      })
  }

  return (
    <Overlay
      isOpen={isOpen}
      onClick={handleClose}
    >
      <div className="modal cancel-order-modal driver-trip-cancel-modal message-window">
        <h3>{t(TRANSLATION.DRIVER_TRIP_CANCEL_TITLE)}</h3>
        {!!orderId && (
          <div className="cancel-order-modal__order-id">
            <OrderId orderId={orderId} variant="full" />
          </div>
        )}
        <fieldset className="cancel-order-modal__reasons" aria-label={t(TRANSLATION.DRIVER_TRIP_CANCEL_TITLE)} disabled={isSubmitting}>
          {reasons.map(item => <label key={item.id} className={cn('reason-item', { 'reason-item--active': reason === item.id })}>
            <input type="radio" name="driver-trip-cancel-reason" checked={reason === item.id} onChange={() => setReason(item.id)} />
            <span>{item.label}</span>
          </label>)}
        </fieldset>
        {error && <p role="alert">{error}</p>}
        <div className="modal__buttons-block">
          <Button
            type="button"
            data-testid="driver-trip-cancel-confirm"
            aria-busy={isSubmitting}
            intent="danger"
            text={isSubmitting ? t(TRANSLATION.LOADING) : t(TRANSLATION.INTERRUPT_TRIP)}
            onClick={handleConfirm}
            disabled={isSubmitting || !orderId}
          />
          <Button
            intent="neutral"
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
