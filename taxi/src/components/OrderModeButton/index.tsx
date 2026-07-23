import React, { useCallback, useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import cn from 'classnames'
import images from '../../constants/images'
import { t, TRANSLATION } from '../../localization'
import { useDispatch, useSimpleSelector } from '../../tools/hooks'
import {
  orderControlModeActionCreators,
  orderControlModeSelectors,
} from '../../state/orderControlMode'
import {
  EOrderControlMode,
  ORDER_CONTROL_MODE_ORDER,
} from '../../state/orderControlMode/constants'
import './styles.scss'

/** Через сколько после клика фактически применяется режим и показывается тост. */
const COMMIT_DELAY_MS = 2000
/** Длительность анимации прокрутки стрелок / смены иконки. */
const SPIN_DURATION_MS = 600
/** Сколько висит тост «X режим вкл.». */
const TOAST_DURATION_MS = 2500

function getNextMode(mode: EOrderControlMode): EOrderControlMode {
  const index = ORDER_CONTROL_MODE_ORDER.indexOf(mode)
  return ORDER_CONTROL_MODE_ORDER[(index + 1) % ORDER_CONTROL_MODE_ORDER.length]
}

function getModeName(mode: EOrderControlMode): string {
  switch (mode) {
    case EOrderControlMode.Realistic:
      return t(TRANSLATION.ORDER_MODE_REALISTIC)
    case EOrderControlMode.Strict:
      return t(TRANSLATION.ORDER_MODE_STRICT)
    case EOrderControlMode.Manual:
    default:
      return t(TRANSLATION.ORDER_MODE_MANUAL)
  }
}

const ModeIcon: React.FC<{ mode: EOrderControlMode }> = ({ mode }) => {
  if (mode === EOrderControlMode.Strict)
    return <span className="order-mode-button__letter">A</span>

  return (
    <img
      src={mode === EOrderControlMode.Manual ? images.orderModeManual : images.orderModeRealistic}
      alt=""
    />
  )
}

const OrderModeToast: React.FC<{ mode: EOrderControlMode }> = ({ mode }) => {
  if (typeof document === 'undefined')
    return null

  return ReactDOM.createPortal(
    <div className="order-mode-toast" role="status">
      <img className="order-mode-toast__icon" src={images.orderModeComplete} alt="" />
      <span className="order-mode-toast__text">
        {getModeName(mode)} {t(TRANSLATION.ORDER_MODE_ENABLED)}
      </span>
    </div>,
    document.body,
  )
}

const OrderModeButton: React.FC = () => {
  const dispatch = useDispatch()
  const committedMode = useSimpleSelector(orderControlModeSelectors.orderControlMode)

  // То, что показывается на кнопке (меняется сразу по клику).
  const [displayMode, setDisplayMode] = useState<EOrderControlMode>(committedMode)
  const [spinning, setSpinning] = useState(false)
  const [toastMode, setToastMode] = useState<EOrderControlMode | null>(null)

  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const spinTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const interactingRef = useRef(false)

  // Синхронизируем отображение с хранилищем, пока пользователь не в процессе выбора.
  useEffect(() => {
    if (!interactingRef.current)
      setDisplayMode(committedMode)
  }, [committedMode])

  useEffect(() => () => {
    if (commitTimer.current) clearTimeout(commitTimer.current)
    if (spinTimer.current) clearTimeout(spinTimer.current)
    if (toastTimer.current) clearTimeout(toastTimer.current)
  }, [])

  const handleClick = useCallback(() => {
    const target = getNextMode(displayMode)
    interactingRef.current = true

    // Иконка меняется сразу + анимация прокрутки стрелок.
    setDisplayMode(target)
    setSpinning(true)
    if (spinTimer.current) clearTimeout(spinTimer.current)
    spinTimer.current = setTimeout(() => setSpinning(false), SPIN_DURATION_MS)

    // Фактическое переключение — только через 2 секунды бездействия.
    if (commitTimer.current) clearTimeout(commitTimer.current)
    commitTimer.current = setTimeout(() => {
      interactingRef.current = false
      dispatch(orderControlModeActionCreators.setOrderControlMode(target))

      setToastMode(target)
      if (toastTimer.current) clearTimeout(toastTimer.current)
      toastTimer.current = setTimeout(() => setToastMode(null), TOAST_DURATION_MS)
    }, COMMIT_DELAY_MS)
  }, [displayMode, dispatch])

  return (
    <>
      <button
        type="button"
        className={cn('order-mode-button', { 'order-mode-button--spinning': spinning })}
        onPointerDown={event => event.stopPropagation()}
        onMouseDown={event => event.stopPropagation()}
        onTouchStart={event => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          handleClick()
        }}
        aria-label={t(TRANSLATION.ORDER_MODE_SWITCH)}
        title={getModeName(displayMode)}
      >
        <img className="order-mode-button__arrows" src={images.orderModeArrows} alt="" />
        <span className="order-mode-button__icon" key={displayMode}>
          <ModeIcon mode={displayMode} />
        </span>
      </button>
      {toastMode && <OrderModeToast mode={toastMode} />}
    </>
  )
}

export default OrderModeButton
