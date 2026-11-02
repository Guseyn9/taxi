import React, { useRef } from 'react'
import {Sparkles,Check,Hand} from 'lucide-react'
import cn from 'classnames'
import { connect, ConnectedProps } from 'react-redux'
import { EBookingLocationKinds } from '../../types/types'
import { IRootState } from '../../state'
import {
  clientOrderSelectors,
  clientOrderActionCreators,
} from '../../state/clientOrder'
import { t, TRANSLATION } from '../../localization'
import { configSelectors } from '../../state/config'
import { hasOfferOrderSupport } from '../../tools/driverOffer'
import SITE_CONSTANTS from '../../siteConstants'
import './styles.scss'

const mapStateToProps = (state: IRootState) => ({
  locationClasses: clientOrderSelectors.availableLocationClasses(state),
  locationClass: clientOrderSelectors.locationClass(state),
  locationClassSelectionMode: clientOrderSelectors.locationClassSelectionMode(state),
  algorithmLocationClass: clientOrderSelectors.algorithmLocationClass(state),
  from: clientOrderSelectors.from(state),
  to: clientOrderSelectors.to(state),
  language: configSelectors.language(state),
})

const mapDispatchToProps = {
  setLocationClass: clientOrderActionCreators.setLocationClass,
}

const connector = connect(mapStateToProps, mapDispatchToProps)

interface IProps extends ConnectedProps<typeof connector> {}

function BoundaryButtons({
  locationClasses,
  locationClass,
  locationClassSelectionMode,
  algorithmLocationClass,
  from,
  to,
  setLocationClass,
  language,
}: IProps) {
  void language

  const disabled = locationClasses === null
  const prevLocationClasses = useRef(locationClasses ?? [])
  if (locationClasses === null)
    locationClasses = prevLocationClasses.current
  else
    prevLocationClasses.current = locationClasses

  const offerSupport = hasOfferOrderSupport()
  const renderLocationClasses = SITE_CONSTANTS.BOOKING_LOCATION_CLASSES
  const hasResolvedLocationContext = Boolean(
    from?.latitude !== undefined &&
    from?.longitude !== undefined &&
    to?.latitude !== undefined &&
    to?.longitude !== undefined &&
    !from?.isAddressResolving &&
    !to?.isAddressResolving,
  )

  const getStatus = (id: string, selected: boolean): TBoundaryButtonStatus => {
    const isAlgorithmChoice = hasResolvedLocationContext &&
      algorithmLocationClass !== null &&
      algorithmLocationClass !== undefined &&
      String(algorithmLocationClass) === String(id)

    if (locationClassSelectionMode === 'manual') {
      if (selected)
        return isAlgorithmChoice ? 'auto' : 'manual-override'

      return isAlgorithmChoice ? 'auto' : 'none'
    }

    if (isAlgorithmChoice)
      return 'auto'

    return selected && hasResolvedLocationContext ? 'auto' : 'none'
  }

  const handleLocationClassClick = (id: string) => {
    if (disabled)
      return

    const isAlgorithmChoice = hasResolvedLocationContext &&
      algorithmLocationClass !== null &&
      algorithmLocationClass !== undefined &&
      String(algorithmLocationClass) === String(id)

    setLocationClass({
      id,
      mode: isAlgorithmChoice ? 'auto' : 'manual',
    })
  }

  return (
    <div
      className={cn('boundary-buttons', {
        'boundary-buttons--disabled': disabled,
      })}
    >
      {renderLocationClasses.map(({ id, kind }) => {
        const selected = locationClassSelectionMode === 'auto' &&
          algorithmLocationClass !== null &&
          algorithmLocationClass !== undefined ?
          String(id) === String(algorithmLocationClass) :
          String(id) === String(locationClass)
        const label = {
          [EBookingLocationKinds.City]: t(TRANSLATION.CLIENT_CITY_ORDER_MODE),
          [EBookingLocationKinds.Intercity]: offerSupport ? t(TRANSLATION.CLIENT_INTERCITY_ORDER_MODE) : t(TRANSLATION.BOOKING_LOCATION_CLASSES[id]),
          [EBookingLocationKinds.Location]: t(TRANSLATION.BOOKING_LOCATION_CLASSES[id]),
        }[kind]
        const image={ [EBookingLocationKinds.City]:'city',[EBookingLocationKinds.Intercity]:'intercity',[EBookingLocationKinds.Location]:'regional' }[kind]
        return (
          <button
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={selected}
            disabled={disabled}
            key={id}
            className={cn('boundary-buttons__item', {
              'boundary-buttons__item--active': selected,
            })}
            // Контракт для E2E: класс поездки, выбранный алгоритмом или пассажиром.
            data-testid="passenger-order-location-class"
            data-location-class={id}
            data-active={selected ? 'true' : 'false'}
            onClick={() => handleLocationClassClick(id)}
          >
            <div className="boundary-buttons__icon">
              <img src={`/design-v2/categories/${image}-warm-v2.png`} alt="" width={40} height={40} decoding="async"/>
            </div>
            <BoundaryStatusIcon status={getStatus(id, selected)} />
            <span className="boundary-buttons__text">{label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export default connector(BoundaryButtons)


type TBoundaryButtonStatus = 'none' | 'auto' | 'manual' | 'manual-override'

function BoundaryStatusIcon({ status }: { status: TBoundaryButtonStatus }) {
  if (status === 'none')
    return null
  const StatusIcon={auto:Sparkles,manual:Check,'manual-override':Hand}[status]

  return (
    <span className={`boundary-buttons__status boundary-buttons__status--${status}`} aria-hidden="true">
      <span className="boundary-buttons__status-badge">
        <StatusIcon size={12} strokeWidth={2.5}/>
      </span>
    </span>
  )
}
