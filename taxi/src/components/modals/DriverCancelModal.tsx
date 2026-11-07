import React, { useEffect, useRef, useState } from 'react'
import { connect, ConnectedProps } from 'react-redux'
import Button from '../Button'
import OrderId from '../OrderId'
import './styles.scss'
import { driverMapGateway } from '../../platform/adapters/DriverMapGateway'
import { t, TRANSLATION } from '../../localization'
import { modalsActionCreators, modalsSelectors } from '../../state/modals'
import { IRootState } from '../../state'
import Overlay from './Overlay'
import { orderSelectors } from '../../state/order'
import { userSelectors } from '../../state/user'
import { runDriverSelfCancellation } from '../../tools/driverSelfCancel'
import { getApiErrorMessage } from '../../tools/apiMessages'
import { PLATFORM_ROUTES, usePlatformNavigate } from '../../platform/platform-interface'

const mapStateToProps = (state: IRootState) => ({
  isOpen: modalsSelectors.isDriverCancelModalOpen(state),
  selectedOrderId: orderSelectors.selectedOrderId(state),
  user: userSelectors.user(state),
})

const mapDispatchToProps = {
  setDriverCancelModal: modalsActionCreators.setDriverCancelModal,
  closeAllModals: modalsActionCreators.closeAllModals,
}

const connector = connect(mapStateToProps, mapDispatchToProps)

interface IProps extends ConnectedProps<typeof connector> {
}

export const CancelDriverOrderModal: React.FC<IProps> = ({
  isOpen,
  setDriverCancelModal,
  closeAllModals,
  selectedOrderId,
  user,
}) => {
  const navigate = usePlatformNavigate()
  const pending = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (isOpen) setError('') }, [isOpen, selectedOrderId])

  const close = () => { if (!pending.current) setDriverCancelModal(false) }
  const onCancel = async() => {
    if (!selectedOrderId || pending.current) return
    pending.current = true
    setSubmitting(true)
    setError('')
    try {
      // The driver port resolves only after a successful backend response or
      // FSM completion. Keep the dialog and current route until then.
      await runDriverSelfCancellation(selectedOrderId, user?.u_id,
        () => driverMapGateway.cancel(selectedOrderId))
      closeAllModals()
      navigate(PLATFORM_ROUTES.DriverOrders)
    } catch (failure) {
      setError(getApiErrorMessage(failure, { context: 'driver-order' }))
    } finally {
      pending.current = false
      setSubmitting(false)
    }
  }

  return (
    <Overlay
      isOpen={isOpen}
      onClick={close}
    >
      <div
        className="modal your-order-modal"
      >
        <form onSubmit={event => event.preventDefault()}>
          <fieldset>
            <legend>
              {t(TRANSLATION.CANCEL_ORDER)} <OrderId orderId={selectedOrderId} variant="full" />
            </legend>
            <div className="status">
              <span>{t(TRANSLATION.CANCEL_ORDER_CONFIRMATION)}</span>
              <Button
                // Контракт для E2E (A.1.4): подтверждение отказа водителя от
                // назначенного заказа. Подпись — «OK», по ней окно не отличить
                // от других подтверждений.
                data-testid="driver-order-cancel-confirm"
                type="button"
                disabled={submitting || !selectedOrderId}
                aria-busy={submitting}
                text={t(submitting ? TRANSLATION.LOADING : TRANSLATION.OK)}
                className="ok-btn"
                onClick={onCancel}
              />
            </div>
            {error && <p role="alert">{error}</p>}
          </fieldset>
        </form>
      </div>
    </Overlay>
  )
}

export default connector(CancelDriverOrderModal)
