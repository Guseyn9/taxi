import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import images from '../../constants/images'
import {
  IOrderModeToast,
  dismissOrderModeToast,
  subscribeOrderModeToast,
} from '../../tools/orderModeToast'
import './styles.scss'

const OrderModeToast: React.FC = () => {
  const [toast, setToast] = useState<IOrderModeToast | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => subscribeOrderModeToast(setToast), [])

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (!toast)
      return

    timerRef.current = setTimeout(() => {
      dismissOrderModeToast(toast.id)
    }, toast.duration)

    return () => {
      if (timerRef.current)
        clearTimeout(timerRef.current)
    }
  }, [toast?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!toast || typeof document === 'undefined')
    return null

  return ReactDOM.createPortal(
    <div className="order-mode-toast-card" role="status">
      <div className="order-mode-toast-card__header">
        <img className="order-mode-toast-card__icon" src={images.orderModeCarIcon} alt="" />
        <span className="order-mode-toast-card__label">{toast.orderLabel}</span>
      </div>
      <div className="order-mode-toast-card__message">{toast.message}</div>
    </div>,
    document.body,
  )
}

export default OrderModeToast
