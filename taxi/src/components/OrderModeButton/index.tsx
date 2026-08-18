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
  ERealisticSubMode,
  ORDER_CONTROL_MODE_ORDER,
} from '../../state/orderControlMode/constants'
import OrderModeSubModeModal from '../OrderModeSubModeModal'
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

function getModeName(mode: EOrderControlMode, subMode?: ERealisticSubMode): string {
  switch (mode) {
    case EOrderControlMode.Realistic:
      // Подтип у Реалистичного всегда выбран, но пока он не спрошен (первые 2 с
      // после клика) показываем нейтральное имя режима.
      if (!subMode)
        return t(TRANSLATION.ORDER_MODE_REALISTIC)
      return t(subMode === ERealisticSubMode.Minus ?
        TRANSLATION.ORDER_MODE_REALISTIC_MINUS :
        TRANSLATION.ORDER_MODE_REALISTIC_PLUS)
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

const OrderModeToast: React.FC<{ name: string }> = ({ name }) => {
  if (typeof document === 'undefined')
    return null

  return ReactDOM.createPortal(
    <div className="order-mode-toast" role="status">
      <img className="order-mode-toast__icon" src={images.orderModeComplete} alt="" />
      <span className="order-mode-toast__text">
        {name} {t(TRANSLATION.ORDER_MODE_ENABLED)}
      </span>
    </div>,
    document.body,
  )
}

const OrderModeButton: React.FC = () => {
  const dispatch = useDispatch()
  const committedMode = useSimpleSelector(orderControlModeSelectors.orderControlMode)
  const committedSubMode = useSimpleSelector(orderControlModeSelectors.realisticSubMode)

  // То, что показывается на кнопке (меняется сразу по клику).
  const [displayMode, setDisplayMode] = useState<EOrderControlMode>(committedMode)
  const [spinning, setSpinning] = useState(false)
  const [toastName, setToastName] = useState<string | null>(null)
  // Окно выбора подтипа Реалистичного — открывается после применения режима.
  const [subModePrompt, setSubModePrompt] = useState(false)

  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const subModeCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
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
    if (subModeCommitTimer.current) clearTimeout(subModeCommitTimer.current)
    if (spinTimer.current) clearTimeout(spinTimer.current)
    if (toastTimer.current) clearTimeout(toastTimer.current)
  }, [])

  const showToast = useCallback((name: string) => {
    setToastName(name)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastName(null), TOAST_DURATION_MS)
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
    // Клик отменяет отложенное включение Реалистичного, если водитель
    // передумал сразу после выбора подтипа.
    if (subModeCommitTimer.current) clearTimeout(subModeCommitTimer.current)
    commitTimer.current = setTimeout(() => {
      // У Реалистичного сначала спрашиваем подтип. Режим НЕ включаем: иначе
      // автоматика начнёт разбирать заказы прямо за окном выбора, а водитель
      // ещё даже не выбрал, какой это будет Реалистичный.
      if (target === EOrderControlMode.Realistic) {
        if (toastTimer.current) clearTimeout(toastTimer.current)
        setToastName(null)
        setSubModePrompt(true)
        return
      }

      interactingRef.current = false
      dispatch(orderControlModeActionCreators.setOrderControlMode(target))
      showToast(getModeName(target))
    }, COMMIT_DELAY_MS)
  }, [displayMode, dispatch, showToast])

  const handleSubModeSelect = useCallback((subMode: ERealisticSubMode) => {
    setSubModePrompt(false)

    // Та же пауза, что и у остальных режимов: окно закрылось — режим включается
    // через 2 секунды, тогда же приходит уведомление.
    if (subModeCommitTimer.current) clearTimeout(subModeCommitTimer.current)
    subModeCommitTimer.current = setTimeout(() => {
      interactingRef.current = false
      // Подтип — раньше режима: к моменту включения Реалистичного окна решений
      // должны уже знать, на какой кнопке тикает таймер.
      dispatch(orderControlModeActionCreators.setRealisticSubMode(subMode))
      dispatch(orderControlModeActionCreators.setOrderControlMode(EOrderControlMode.Realistic))
      showToast(getModeName(EOrderControlMode.Realistic, subMode))
    }, COMMIT_DELAY_MS)
  }, [dispatch, showToast])

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
        title={getModeName(displayMode, displayMode === committedMode ? committedSubMode : undefined)}
      >
        <img className="order-mode-button__arrows" src={images.orderModeArrows} alt="" />
        <span className="order-mode-button__icon" key={displayMode}>
          <ModeIcon mode={displayMode} />
        </span>
      </button>
      {subModePrompt && <OrderModeSubModeModal onSelect={handleSubModeSelect} />}
      {toastName && <OrderModeToast name={toastName} />}
    </>
  )
}

export default OrderModeButton
