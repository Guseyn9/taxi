import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import {Clock3,CalendarDays,CalendarClock,Check,ChevronRight} from 'lucide-react'
import cn from 'classnames'
import { connect, ConnectedProps } from 'react-redux'
import moment from 'moment'
import { t, TRANSLATION } from '../../localization'
import {
  clientOrderActionCreators,
  clientOrderSelectors,
} from '../../state/clientOrder'
import { IRootState } from '../../state'
import { modalsActionCreators, modalsSelectors } from '../../state/modals'
import { dateFormatTimeShort } from '../../tools/utils'
import Overlay from './Overlay'
import './styles.scss'



const mapStateToProps = (state: IRootState) => ({
  isOpen: modalsSelectors.isPickTimeModalOpen(state),
  time: clientOrderSelectors.time(state),
})

const mapDispatchToProps = {
  setTime: clientOrderActionCreators.setTime,
  setPickTimeModal: modalsActionCreators.setPickTimeModal,
}

const connector = connect(mapStateToProps, mapDispatchToProps)

interface IProps extends ConnectedProps<typeof connector> {}

enum EPeriods {
  Today,
  Now,
  Tomorrow
}

export const PickTimeModal: React.FC<IProps> = ({
  isOpen,
  time,
  setTime,
  setPickTimeModal,
}) => {
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [period, setPeriod] = useState(EPeriods.Now)
  const [clock, setClock] = useState('12:00')
  const clockInput = useRef<HTMLInputElement>(null)
  useEffect(() => { if (isOpen) {
    setIsPickerOpen(false)
    setClock((time === 'now' ? moment().add(5, 'minutes') : time).format('HH:mm'))
  } }, [isOpen])

  const onPeriodClick = useCallback((item: EPeriods) => {
    setPeriod(item)
    if (item === EPeriods.Now) {
      setTime('now')
      setIsPickerOpen(false)
      setPickTimeModal(false)
    } else
      setIsPickerOpen(true)
  }, [])

  const items = [
    { label: t(TRANSLATION.NOW), value: EPeriods.Now,icon:Clock3 },
    { label: t(TRANSLATION.TODAY), value: EPeriods.Today,icon:CalendarDays },
    { label: t(TRANSLATION.TOMORROW), value: EPeriods.Tomorrow,icon:CalendarClock },
  ]
  const activePeriod = useMemo(
    () => time === 'now' ?
      EPeriods.Now :
      time.isSame(moment(), 'day') ?
        EPeriods.Today :
        time.isSame(moment().add(1, 'days'), 'day') ?
          EPeriods.Tomorrow :
          null,
    [time],
  )

  return (
    <Overlay
      isOpen={isOpen}
      onClick={useCallback(() => {
        setPickTimeModal(false)
        setIsPickerOpen(false)
      }, [])}
    >
      <div className="modal timer-modal" hidden={isPickerOpen}>
        <h2 className="rs-dialog-title">{t(TRANSLATION.START_TIME)}</h2>
        {useMemo(() => items.map((item, index) =>
          <div key={item.value} className="timer-modal__item">
            <button
              type="button"
              aria-pressed={activePeriod === item.value}
              className={cn('timer-modal__button', {
                'timer-modal__button--active': activePeriod === item.value,
              })}
              onClick={() => onPeriodClick(item.value)}
            >
              <span className="timer-modal__icon"><item.icon size={22} aria-hidden="true"/></span><span className="timer-modal__copy">{item.label}
              {activePeriod === item.value && typeof time !== 'string' &&
                <span className="timer-modal__label">
                  <span>{time.format(dateFormatTimeShort)}</span>
                </span>
              }
              </span>{activePeriod===item.value ? <Check size={20} aria-hidden="true"/> : <ChevronRight size={18} aria-hidden="true"/>}
            </button>
            <span className="timer-modal__separator" />
          </div>,
        ), [time, activePeriod])}
      </div>
      {isPickerOpen && <div className="modal timer-modal timer-modal__clock">
        <h2>{t(TRANSLATION.START_TIME)} · {t(period === EPeriods.Tomorrow ? TRANSLATION.TOMORROW : TRANSLATION.TODAY)}</h2>
        <label className="timer-modal__clock-label">{t(TRANSLATION.START_TIME)}
          <input ref={clockInput} type="time" value={clock} onChange={event => setClock(event.target.value)} required aria-label={t(TRANSLATION.START_TIME)} />
        </label>
        <button type="button" className="timer-modal__clock-confirm" disabled={!/^\d{2}:\d{2}$/.test(clock)} onClick={() => {
          const value = clockInput.current?.value ?? clock
          if (!/^\d{2}:\d{2}$/.test(value)) return
          const [hours, minutes] = value.split(':').map(Number)
          setTime(moment().startOf('day').add(period === EPeriods.Tomorrow ? 1 : 0, 'days').hours(hours).minutes(minutes))
          setIsPickerOpen(false)
          setPickTimeModal(false)
        }}>{t(TRANSLATION.SAVE, {toUpper:false})}</button>
        <button type="button" className="timer-modal__clock-back" onClick={() => setIsPickerOpen(false)}>{t(TRANSLATION.CANCEL, {toUpper:false})}</button>
      </div>}

    </Overlay>
  )
}

export default connector(PickTimeModal)
