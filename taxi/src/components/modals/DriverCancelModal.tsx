import React from 'react'
import { connect, ConnectedProps } from 'react-redux'
import Button from '../Button'
import OrderId from '../OrderId'
import './styles.scss'
import { passengerGateway } from '../../platform/adapters/LegacyPassengerGateway'
import { t, TRANSLATION } from '../../localization'
import { modalsActionCreators, modalsSelectors } from '../../state/modals'
import { IRootState } from '../../state'
import Overlay from './Overlay'
import { orderSelectors } from '../../state/order'
import { userSelectors } from '../../state/user'
import { clearOrderCancelledByDriver, markOrderCancelledByDriver } from '../../tools/driverSelfCancel'
import { PLATFORM_ROUTES, usePlatformNavigate } from '../../platform/platform-interface'

const mapStateToProps = (state: IRootState) => ({
  isOpen: modalsSelectors.isDriverCancelModalOpen(state),
  selectedOrderId: orderSelectors.selectedOrderId(state),
  user: userSelectors.user(state),
})

const mapDispatchToProps = {
  setDriverCancelModal: modalsActionCreators.setDriverCancelModal,
}

const connector = connect(mapStateToProps, mapDispatchToProps)

interface IProps extends ConnectedProps<typeof connector> {
}

const CancelDriverOrderModal: React.FC<IProps> = ({
  isOpen,
  setDriverCancelModal,
  selectedOrderId,
  user,
}) => {
  const navigate = usePlatformNavigate()

  const onCancel = () => {
    console.log('onCancel', selectedOrderId)
    if (selectedOrderId) {
      // Отмена водителем не должна отзываться окном «Клиент отменил заказ».
      markOrderCancelledByDriver(selectedOrderId, user?.u_id)
      passengerGateway.cancelOrder(selectedOrderId)
        .catch(error => {
          console.error(error)
          clearOrderCancelledByDriver(selectedOrderId, user?.u_id)
        })
      navigate(PLATFORM_ROUTES.DriverOrders)
    }
    setDriverCancelModal(false)
  }

  return (
    <Overlay
      isOpen={isOpen}
      onClick={() => setDriverCancelModal(false)}
    >
      <div
        className="modal your-order-modal"
      >
        <form>
          <fieldset>
            <legend>
              {t(TRANSLATION.CANCEL_ORDER)} <OrderId orderId={selectedOrderId} variant="full" />
            </legend>
            <div className="status">
              <span>{t(TRANSLATION.CANCEL_ORDER_CONFIRMATION)}</span>
              <Button
                text={t(TRANSLATION.OK)}
                className="ok-btn"
                onClick={onCancel}
              />
            </div>
          </fieldset>
        </form>
      </div>
    </Overlay>
  )
}

export default connector(CancelDriverOrderModal)
