import React, { useCallback, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import { t, TRANSLATION } from '../../localization'
import { ERealisticSubMode } from '../../state/orderControlMode/constants'
import './styles.scss'

/**
 * Сколько ждём выбора, прежде чем молча включить «Реалистичный +».
 * Оставшееся время водителю намеренно не показываем.
 */
const AUTO_SELECT_DELAY_MS = 10000

/**
 * ВРЕМЕННО ВЫКЛЮЧЕНО: окно дорабатывается по дизайну, и автозакрытие мешает его
 * рассмотреть. Вернуть `true` — и автовыбор «Реалистичный +» по таймеру снова
 * заработает, остальная логика окна от этого не зависит.
 */
const AUTO_SELECT_ENABLED: boolean = false

interface IProps {
  /** Вызывается ровно один раз: по кнопке, по клику вне окна или по таймеру. */
  onSelect: (subMode: ERealisticSubMode) => void
}

const OrderModeSubModeModal: React.FC<IProps> = ({ onSelect }) => {
  const selectedRef = useRef(false)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  const select = useCallback((subMode: ERealisticSubMode) => {
    if (selectedRef.current)
      return
    selectedRef.current = true
    onSelectRef.current(subMode)
  }, [])

  // Молчание водителя — это «Реалистичный +».
  useEffect(() => {
    if (!AUTO_SELECT_ENABLED)
      return
    const timer = setTimeout(() => select(ERealisticSubMode.Plus), AUTO_SELECT_DELAY_MS)
    return () => clearTimeout(timer)
  }, [select])

  if (typeof document === 'undefined')
    return null

  const renderOption = (subMode: ERealisticSubMode) => {
    const isPlus = subMode === ERealisticSubMode.Plus

    return (
      <div className="order-mode-sub__option">
        <button
          type="button"
          className={`order-mode-sub__btn order-mode-sub__btn--${isPlus ? 'plus' : 'minus'}`}
          onClick={() => select(subMode)}
        >
          {t(isPlus ? TRANSLATION.ORDER_MODE_REALISTIC_PLUS : TRANSLATION.ORDER_MODE_REALISTIC_MINUS)}
        </button>
        <span className="order-mode-sub__tick" />
        <div className="order-mode-sub__hint">
          {t(TRANSLATION.ORDER_MODE_REALISTIC_SUB_HINT)}{' '}
          <span className="order-mode-sub__hint-accent">
            {t(isPlus ?
              TRANSLATION.ORDER_MODE_REALISTIC_SUB_HINT_TAKE :
              TRANSLATION.ORDER_MODE_REALISTIC_SUB_HINT_CANCEL)}
          </span>
        </div>
      </div>
    )
  }

  return ReactDOM.createPortal(
    <div
      className="order-mode-sub"
      role="dialog"
      aria-modal="true"
      // Клик мимо окна — тоже выбор, «Реалистичный +».
      onClick={() => select(ERealisticSubMode.Plus)}
    >
      <div className="order-mode-sub__card" onClick={event => event.stopPropagation()}>
        <div className="order-mode-sub__title">{t(TRANSLATION.ORDER_MODE_REALISTIC_SUB_TITLE)}</div>
        <div className="order-mode-sub__subtitle">
          {t(TRANSLATION.ORDER_MODE_REALISTIC_SUB_SUBTITLE)}
        </div>
        {renderOption(ERealisticSubMode.Plus)}
        {renderOption(ERealisticSubMode.Minus)}
      </div>
    </div>,
    document.body,
  )
}

export default OrderModeSubModeModal
