import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import {
  IOrderModeDecisionRequest,
  dismissOrderModeDecision,
  subscribeOrderModeDecision,
} from '../../tools/orderModeDecision'
import { useSimpleSelector } from '../../tools/hooks'
import { orderControlModeSelectors } from '../../state/orderControlMode'
import { ERealisticSubMode } from '../../state/orderControlMode/constants'
import './styles.scss'

const OrderModeDecisionModal: React.FC = () => {
  const subMode = useSimpleSelector(orderControlModeSelectors.realisticSubMode)
  const [request, setRequest] = useState<IOrderModeDecisionRequest | null>(null)
  const [remaining, setRemaining] = useState(0)
  /**
   * Куда «падает» решение по истечении таймера: «Реалистичный +» — на действие,
   * «Реалистичный -» — на отказ. Фиксируем на всё время жизни окна, чтобы смена
   * подтипа посреди отсчёта не перевешивала таймер с кнопки на кнопку.
   */
  const [expiresOnCancel, setExpiresOnCancel] = useState(false)
  const [decisionId, setDecisionId] = useState<string | null>(null)
  const resolvedRef = useRef(false)
  const expiresOnCancelRef = useRef(false)

  useEffect(() => subscribeOrderModeDecision(setRequest), [])

  // Стартовые значения отсчёта выставляем прямо в рендере: если делать это в
  // эффекте, первый кадр нового окна успевает показать «(0)» — и, что хуже,
  // на кнопке от предыдущего подтипа режима.
  if (request && request.id !== decisionId) {
    setDecisionId(request.id)
    setRemaining(request.seconds)
    setExpiresOnCancel(subMode === ERealisticSubMode.Minus)
    expiresOnCancelRef.current = subMode === ERealisticSubMode.Minus
  }
  if (!request && decisionId !== null)
    setDecisionId(null)

  // Перезапускаем таймер при появлении нового решения (по смене id).
  useEffect(() => {
    resolvedRef.current = false
    if (!request) {
      setRemaining(0)
      return
    }

    const onCancelByTimer = expiresOnCancelRef.current
    let cancelled = false

    const interval = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval)
          if (!cancelled && !resolvedRef.current) {
            resolvedRef.current = true
            if (onCancelByTimer)
              request.onCancel()
            else
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
    if (resolvedRef.current)
      return
    resolvedRef.current = true
    request.onConfirm()
    dismissOrderModeDecision(request.id)
  }

  const handleCancel = () => {
    if (resolvedRef.current)
      return
    resolvedRef.current = true
    request.onCancel()
    dismissOrderModeDecision(request.id)
  }

  return ReactDOM.createPortal(
    <div className="order-mode-decision" role="dialog" aria-modal="true">
      <div className="order-mode-decision__card">
        {request.orderLabel && (
          <div className="order-mode-decision__order">{request.orderLabel}</div>
        )}
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
            {request.actionText}{!expiresOnCancel && ` (${remaining})`}
          </button>
          <button
            type="button"
            className="order-mode-decision__btn order-mode-decision__btn--cancel"
            onClick={handleCancel}
          >
            {request.cancelText}{expiresOnCancel && ` (${remaining})`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default OrderModeDecisionModal
