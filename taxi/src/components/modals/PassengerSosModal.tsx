import React, { useEffect, useMemo, useState } from 'react'
import { connect, ConnectedProps } from 'react-redux'
import cn from 'classnames'
import { EStatuses } from '../../types/types'
import SITE_CONSTANTS from '../../siteConstants'
import { t, TRANSLATION } from '../../localization'
import { getLocalizedCancelReasons } from '../../tools/cancelReasons'
import { submitPassengerSos } from '../../tools/passengerSos'
import { IRootState } from '../../state'
import { modalsActionCreators, modalsSelectors } from '../../state/modals'
import { clientOrderActionCreators } from '../../state/clientOrder'
import { ordersActionCreators } from '../../state/orders'
import Button from '../Button'
import OrderId from '../OrderId'
import Overlay from './Overlay'
import './styles.scss'

const mapStateToProps = (state: IRootState) => ({
  modal: modalsSelectors.sosModal(state),
})

const mapDispatchToProps = {
  setSosModal: modalsActionCreators.setSosModal,
  closeAllModals: modalsActionCreators.closeAllModals,
  setMessageModal: modalsActionCreators.setMessageModal,
  setSelectedOrder: clientOrderActionCreators.setSelectedOrder,
  cancelOrder: ordersActionCreators.cancel,
  refreshActiveOrders: ordersActionCreators.refreshActiveOrders,
}

const connector = connect(mapStateToProps, mapDispatchToProps)

interface IProps extends ConnectedProps<typeof connector> {
}

/**
 * Passenger SOS после Started: пассажир выбирает причину и подтверждает, после
 * чего поездка отменяется существующим `set_cancel_state` (тот же flow, что у
 * обычной пассажирской отмены, но отдельный пользовательский сценарий).
 *
 * В Redux живёт только `isOpen`/`orderId`; выбранная причина, loading и ошибка —
 * локальное состояние компонента, сбрасываемое при каждом открытии.
 */
const PassengerSosModal: React.FC<IProps> = ({
  modal,
  setSosModal,
  closeAllModals,
  setMessageModal,
  setSelectedOrder,
  cancelOrder,
  refreshActiveOrders,
}) => {
  const { isOpen, orderId } = modal
  const reasons = useMemo(() => getLocalizedCancelReasons(SITE_CONSTANTS.CANCEL_ORDER_REASONS), [isOpen])

  const [selectedReasonId, setSelectedReasonId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setSelectedReasonId(null)
      setIsSubmitting(false)
    }
  }, [isOpen, orderId])

  const selectedReason = reasons.find(item => item.id === selectedReasonId)

  const handleClose = () => {
    if (!isSubmitting)
      setSosModal({ isOpen: false })
  }

  const handleSelect = (id: string) => {
    if (!isSubmitting)
      setSelectedReasonId(id)
  }

  const handleConfirm = async() => {
    if (!orderId || !selectedReason || isSubmitting)
      return

    setIsSubmitting(true)
    try {
      await submitPassengerSos(cancelOrder, orderId, selectedReason.label)

      // Успех подтверждён backend'ом — только теперь UI уходит из активной поездки.
      closeAllModals()
      setSelectedOrder(null)
      refreshActiveOrders()
    } catch (error) {
      console.error(error)
      setIsSubmitting(false)
      setMessageModal({
        isOpen: true,
        status: EStatuses.Fail,
        message: t(TRANSLATION.ERROR),
      })
    }
  }

  return (
    <Overlay
      isOpen={isOpen}
      onClick={handleClose}
    >
      {isOpen && (
        <div
          className="modal cancel-order-modal message-window passenger-sos-modal"
          data-testid="sos-alarm-modal"
        >
          <h3>{t(TRANSLATION.PASSENGER_SOS_TITLE)}</h3>
          {!!orderId && (
            <div className="cancel-order-modal__order-id">
              <OrderId orderId={orderId} variant="full" />
            </div>
          )}
          <p className="passenger-sos-modal__description">
            {t(TRANSLATION.PASSENGER_SOS_DESCRIPTION)}
          </p>
          <div role="radiogroup" aria-label={t(TRANSLATION.PASSENGER_SOS_TITLE)}>
            {reasons.map((item, index) => {
              const active = selectedReasonId === item.id
              return (
                <div
                  key={item.id}
                  role="radio"
                  aria-checked={active}
                  tabIndex={0}
                  data-testid={`sos-reason-${index}`}
                  data-reason-id={item.id}
                  onClick={() => handleSelect(item.id)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      handleSelect(item.id)
                    }
                  }}
                  className={cn('reason-item', { 'reason-item--active': active })}
                  style={{ color: active ? SITE_CONSTANTS.PALETTE.primary.dark : undefined }}
                >
                  {item.label}
                </div>
              )
            })}
          </div>
          <div className="modal__buttons-block">
            <Button
              data-testid="sos-confirm"
              text={isSubmitting ? t(TRANSLATION.LOADING) : t(TRANSLATION.PASSENGER_SOS_CONFIRM)}
              onClick={handleConfirm}
              disabled={!selectedReason || isSubmitting}
            />
            <Button
              data-testid="sos-close"
              text={t(TRANSLATION.CANCEL)}
              onClick={handleClose}
              disabled={isSubmitting}
            />
          </div>
        </div>
      )}
    </Overlay>
  )
}

export default connector(PassengerSosModal)
