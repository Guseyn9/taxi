import {taxiColor} from '../../design/maps/taxiPalette'
import SITE_CONSTANTS from '../../siteConstants'
import VehicleArtwork from './VehicleArtwork'
import { Check } from 'lucide-react'
import React, { useRef, useMemo, useEffect } from 'react'
import { connect, ConnectedProps } from 'react-redux'
import cn from 'classnames'
import { formatCurrency } from '../../tools/utils'
import { IRootState } from '../../state'
import {
  clientOrderSelectors,
  clientOrderActionCreators,
} from '../../state/clientOrder'
import { EBookingLocationKinds } from '../../types/types'
import { t, TRANSLATION } from '../../localization'
import './styles.scss'

const mapStateToProps = (state: IRootState) => ({
  fromPoint: clientOrderSelectors.from(state),
  carClasses: clientOrderSelectors.availableCarClasses(state),
  carClass: clientOrderSelectors.carClass(state),
  locationClass: clientOrderSelectors.locationClass(state),
  locationClasses: clientOrderSelectors.availableLocationClasses(state),
})

const mapDispatchToProps = {
  setCarClass: clientOrderActionCreators.setCarClass,
}

const connector = connect(mapStateToProps, mapDispatchToProps)

interface IProps extends ConnectedProps<typeof connector> {}

export function CarClassSlider({ carClasses, carClass, locationClass, locationClasses, setCarClass, fromPoint }: IProps) {

  const disabled = carClasses === null
  const prevCarClasses = useRef(carClasses ?? [])
  if (carClasses === null)
    carClasses = prevCarClasses.current
  else
    prevCarClasses.current = carClasses

  const selectedLocationClass = locationClasses?.find(item => String(item.id) === String(locationClass)) ?? null
  const intercityMode = selectedLocationClass?.kind === EBookingLocationKinds.Intercity
  const visibleCarClasses = useMemo(() => {
    if (!intercityMode)
      return carClasses

    const nonPetit = carClasses.filter(cc => !isPetitCarClass(cc))
    return nonPetit.length ? nonPetit : carClasses
  }, [carClasses, intercityMode])

  useEffect(() => {
    if (!visibleCarClasses.length)
      return
    if (!visibleCarClasses.some(cc => cc.id === carClass))
      setCarClass(visibleCarClasses[0].id)
  }, [visibleCarClasses, carClass, setCarClass])

  return <div className={cn('car-class-slider car-class-slider--native', {'car-class-slider--disabled':disabled})}>
    <ul className="car-class-slider__options">
      {visibleCarClasses.map(cc => <li key={cc.id}>
          <button
            type="button"
            disabled={disabled}
            aria-pressed={cc.id === carClass}
            aria-label={`${t(TRANSLATION.CAR_CLASSES[cc.id]).replace(/petti/ig, 'PETIT')}, ${formatCurrency(cc.courier_call_rate)}`}
            onClick={() => setCarClass(cc.id)}
            className={cn('glide__slide car-class-slider__slide', {
              'car-class-slider__slide--active': cc.id === carClass,
            })}
          >
            <div className="car-class-slider__icon">
              <VehicleArtwork kind={isPetitCarClass(cc) ? 'petit' : 'grand'} color={taxiColor({kind:isPetitCarClass(cc)?'petit':'grand',point:fromPoint?.latitude!==undefined&&fromPoint?.longitude!==undefined?[fromPoint.latitude,fromPoint.longitude]:null,palette:fromPoint?.latitude!==undefined&&fromPoint?.longitude!==undefined?SITE_CONSTANTS.PALETTE?.primary?.main:undefined})}/>
            </div>
            <span className="car-class-slider__title">
              {t(TRANSLATION.CAR_CLASSES[cc.id]).replace(/petti/ig, 'PETIT')}
              {cc.id === carClass && <Check className="rs-car-selected" aria-hidden="true" />}
            </span>
            <span className="car-class-slider__value">
              {formatCurrency(cc.courier_call_rate)}
            </span>
          </button>
      </li>)}
    </ul>
  </div>

}


function isPetitCarClass(carClass: any) {
  const text = [
    carClass?.id,
    carClass?.name,
    carClass?.title,
    carClass?.label,
    carClass?.code,
    t(TRANSLATION.CAR_CLASSES[carClass?.id]),
  ].filter(Boolean).join(' ').toLowerCase()

  return text.includes('petit') || text.includes('petti') || text.includes('петит') || text.includes('econom') || text.includes('эконом')
}

export default connector(CarClassSlider)
