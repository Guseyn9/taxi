import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { connect, ConnectedProps } from 'react-redux'
import { StarRating } from './StarRating'
import { configSelectors } from '../../state/config'
import { isRideRtl } from '../../design/copy'
import moment from 'moment'
import {
  calculateFinalPrice,
  calculateFinalPriceFormula,
  getOrderDriveStartedAt,
} from '../../tools/order'
import { useSimpleSelector } from '../../tools/hooks'
import { CURRENCY } from '../../siteConstants'
import { backendGateway } from '../../platform/adapters/LegacyBackendGateway'
import { IRootState } from '../../state'
import { modalsActionCreators, modalsSelectors } from '../../state/modals'
import { clientOrderSelectors } from '../../state/clientOrder'
import { ordersSelectors } from '../../state/orders'
import { orderSelectors } from '../../state/order'
import { t, TRANSLATION } from '../../localization'
import { writeFlowEvent } from '../../tools/flowLog'
import Button from '../Button'
import OrderId from '../OrderId'
import Overlay from './Overlay'
import './styles.scss'


const mapStateToProps = (state: IRootState) => ({
  isOpen: modalsSelectors.isRatingModalOpen(state),
  language: configSelectors.language(state),
  orderID: modalsSelectors.ratingModalOrderID(state),
  selectedOrder: clientOrderSelectors.selectedOrder(state),
  detailedOrder: orderSelectors.order(state),
})

const mapDispatchToProps = {
  setRatingModal: modalsActionCreators.setRatingModal,
}

const connector = connect(mapStateToProps, mapDispatchToProps)

interface IProps extends ConnectedProps<typeof connector> {}

export function RatingModal({
  language,
  isOpen,
  orderID,
  selectedOrder,
  detailedOrder,
  setRatingModal,
}: IProps) {
  const [stars, setStars] = useState(0)
  const [tips, setTips] = useState('')
  const [comment, setComment] = useState('')
  const [pending, setPending] = useState(false)
  const [submissionError, setSubmissionError] = useState('')
  const inFlight = useRef(false)
  const submission = useRef(0)

  const _orderID = orderID || detailedOrder?.b_id || selectedOrder
  useEffect(() => {
    submission.current++
    inFlight.current = false
    setPending(false)
    setSubmissionError('')
    if (isOpen) {
      setStars(0)
      setTips('')
      setComment('')
    }
    return () => { submission.current++ }
  }, [isOpen, _orderID])
  const order = useSimpleSelector(useCallback((state: IRootState) =>
    (_orderID && String(detailedOrder?.b_id) === String(_orderID) ? detailedOrder : undefined) ??
    (_orderID ? ordersSelectors.order(state, _orderID) : undefined)
  , [detailedOrder, _orderID]))

  // Loading the same order's details must not erase a rating already selected.
  useEffect(() => {
    if (isOpen) {
      if (_orderID) {
        writeFlowEvent('REVIEW_SCREEN_OPEN', {
          orderId: _orderID,
          screen: 'RatingModal',
          uiState: 'ReviewScreenOpen',
          data: {
            orderId: _orderID,
            hasOrderData: Boolean(order),
          },
        })
        writeFlowEvent('REVIEW_SCREEN_OPENED', {
          orderId: _orderID,
          screen: 'RatingModal',
          uiState: 'ReviewScreenOpened',
          data: {
            orderId: _orderID,
            hasOrderData: Boolean(order),
          },
        })
      } else {
        writeFlowEvent('REVIEW_SCREEN_FAILED', {
          screen: 'RatingModal',
          uiState: 'ReviewScreenOpenFailed',
          data: {
            reason: 'missing_order_id',
          },
        })
      }
    }
  }, [isOpen, _orderID, order?.b_id])

  const onRating = async() => {
    if (!isOpen || !_orderID || stars === 0 || inFlight.current) return
    inFlight.current = true
    const request = ++submission.current
    setPending(true)
    setSubmissionError('')
    if (_orderID) {
      writeFlowEvent('LEAVE_REVIEW', {
        orderId: _orderID,
        screen: 'RatingModal',
        uiState: 'ReviewSubmitted',
        data: {
          orderId: _orderID,
          rating: stars,
          hasTips: Boolean(tips),
          hasComment: Boolean(comment),
        },
      })
      writeFlowEvent('REVIEW_SUBMITTED', {
        orderId: _orderID,
        screen: 'RatingModal',
        uiState: 'ReviewSubmitted',
        data: {
          orderId: _orderID,
          rating: stars,
          hasTips: Boolean(tips),
          hasComment: Boolean(comment),
        },
      })
      try {
        await backendGateway.setOrderRating(_orderID, stars)
        if (submission.current === request) setRatingModal({ isOpen: false })
      } catch (error) {
        writeFlowEvent('REVIEW_SCREEN_FAILED', {
          orderId: _orderID,
          screen: 'RatingModal',
          uiState: 'ReviewSubmitFailed',
          data: {
            reason: 'rating_api_error',
            message: error instanceof Error ? error.message : String(error),
          },
        })
        if (submission.current === request) setSubmissionError(t(TRANSLATION.ERROR))
        console.error(error)
      } finally {
        if (submission.current === request) {
          inFlight.current = false
          setPending(false)
        }
      }
    }
  }

  const [finalPriceFormula, finalPrice] = useMemo(() => {
    const driveStartedAt = getOrderDriveStartedAt(order)
    if (order?.b_options?.pricingModel && driveStartedAt && order.b_completed) {
      const start_moment = moment(driveStartedAt)
      const end_moment = moment(order.b_completed)

      const updatedOptions = {
        ...(order.b_options.pricingModel.options || {}),
        duration: end_moment.diff(start_moment, 'minutes'),
      }

      const orderWithUpdatedOptions = {
        ...order,
        b_options: {
          ...order.b_options,
          pricingModel: {
            ...order.b_options.pricingModel,
            options: updatedOptions,
          },
        },
      }

      return [
        calculateFinalPriceFormula(orderWithUpdatedOptions),
        calculateFinalPrice(orderWithUpdatedOptions),
      ]
    }
    return ['err', 0]
  }, [order])

  return (
    <Overlay
      isOpen={isOpen}
      onClick={() => setRatingModal({ isOpen: false })}
    >
      <div
        className="modal rating-modal"
        dir={isRideRtl(language?.iso) ? 'rtl' : undefined}
      >
        <form aria-busy={pending} onSubmit={event => { event.preventDefault(); onRating() }}>
          <fieldset disabled={pending}>
            <legend>{t(TRANSLATION.RATING_HEADER)}!</legend>
            {finalPriceFormula !== 'err' && (
              <div>
                <div className="final-price">
                  {t(TRANSLATION.FINAL_PRICE)}: {finalPrice!=='-'? CURRENCY.SIGN : ''} {finalPrice + (order?.b_options?.pricingModel?.calculationType === 'incomplete' ? '+?' : '')}
                </div>
                <div className="final-price">
                  {t(TRANSLATION.CALCULATION)}: {finalPriceFormula}
                </div>
              </div>
            )}
            {!!_orderID && (
              <div className="rating-modal__order-id">
                <OrderId orderId={_orderID} variant="full" />
              </div>
            )}
            <h3>{t(TRANSLATION.YOUR_RATING)}</h3>
            <div className="rating">
              <StarRating value={stars} onChange={setStars} label={t(TRANSLATION.YOUR_RATING)} />
              <p>({t(TRANSLATION.ONLY_ONE_TIME)})</p>
              {submissionError && <p className="rating-modal__submit-error" role="alert">{submissionError}</p>}
              <Button
                type="submit"
                text={t(pending ? TRANSLATION.LOADING : TRANSLATION.RATE)}
                className="rating-modal_rating-btn"
                disabled={!_orderID || stars === 0 || pending}
              />
            </div>
          </fieldset>
        </form>
      </div>
    </Overlay>
  )
}

export default connector(RatingModal)
