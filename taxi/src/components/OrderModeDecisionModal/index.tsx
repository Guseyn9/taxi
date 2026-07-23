import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import {
  IOrderModeDecisionRequest,
  dismissOrderModeDecision,
  subscribeOrderModeDecision,
} from '../../tools/orderModeDecision'
import './styles.scss'

const OrderModeDecisionModal: React.FC = () => {
  const [request, setRequest] = useState<IOrderModeDecisionRequest | null>(null)
  const [remaining, setRemaining] = useState(0)
  const confirmedRef = useRef(false)

  useEffect(() => subscribeOrderModeDecision(setRequest), [])

  // Перезапускаем таймер при появлении нового решения (по смене id).
  useEffect(() => {
    confirmedRef.current = false
    if (!request) {
      setRemaining(0)
      return
    }

    setRemaining(request.seconds)
    let cancelled = false

    const interval = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval)
          if (!cancelled && !confirmedRef.current) {
            confirmedRef.current = true
            request.onConfirm()
            dismissOrderModeDecision(request.id)
          }
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [request?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!request || typeof document === 'undefined')
    return null

  const handleConfirm = () => {
    if (confirmedRef.current)
      return
    confirmedRef.current = true
    request.onConfirm()
    dismissOrderModeDecision(request.id)
  }

  const handleCancel = () => {
    if (confirmedRef.current)
      return
    confirmedRef.current = true
    request.onCancel()
    dismissOrderModeDecision(request.id)
  }

  return ReactDOM.createPortal(
    <div className="order-mode-decision" role="dialog" aria-modal="true">
      <div className="order-mode-decision__card">
        <div className="order-mode-decision__title">{request.title}</div>
        {request.description && (
          <div className="order-mode-decision__description">{request.description}</div>
        )}
        <div className="order-mode-decision__actions">
          <button
            type="button"
            className="order-mode-decision__btn order-mode-decision__btn--confirm"
            onClick={handleConfirm}
          >
            {request.actionText} ({remaining})
          </button>
          <button
            type="button"
            className="order-mode-decision__btn order-mode-decision__btn--cancel"
            onClick={handleCancel}
          >
            {request.cancelText}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default OrderModeDecisionModal
