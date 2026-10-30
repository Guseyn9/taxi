import { rideCopy } from '../../design/copy'
import useAddressSearch from '../../design/useAddressSearch'
import { journeyCopy } from '../../design/journeyCopy'
import { MOROCCO_CENTER } from '../../design/maps/morocco'
import {displayAddress,displayShortAddress} from '../../design/addressPresentation'
import { configSelectors } from '../../state/config'
import React, { useMemo, useRef, useState } from 'react'
import {rankAddressSuggestions} from '../../tools/rankAddressSuggestions'
import { connect, ConnectedProps } from 'react-redux'
import { ChevronDown,LocateFixed,Flag } from 'lucide-react'
import SITE_CONSTANTS from '../../siteConstants'
import { t, TRANSLATION } from '../../localization'
import { IRootState } from '../../state'
import {
  clientOrderActionCreators,
  clientOrderSelectors,
} from '../../state/clientOrder'
import {
  EPointType,
  ISuggestion, EBookingLocationKinds, IAddressPoint,
} from '../../types/types'
import { backendGateway } from '../../platform/adapters/LegacyBackendGateway'
import { useCachedState } from '../../tools/hooks'
import { cachedOrderDataStateKey } from '../../tools/utils'
import Input, { EInputStyles } from '../Input'
import Overlay from '../modals/Overlay'

const mapStateToProps = (state: IRootState) => ({
  language: configSelectors.language(state),
  from: clientOrderSelectors.from(state),
  to: clientOrderSelectors.to(state),
  locationClass: clientOrderSelectors.locationClass(state),
})

const mapDispatchToProps = {
  setFrom: clientOrderActionCreators.setFrom,
  setTo: clientOrderActionCreators.setTo,
}

const connector = connect(mapStateToProps, mapDispatchToProps)

const hasCoordinates = (point?: IAddressPoint | null): point is IAddressPoint =>
  point?.latitude != null && point?.longitude != null &&
  Number.isFinite(Number(point.latitude)) && Number.isFinite(Number(point.longitude))

interface IProps extends ConnectedProps<typeof connector> {
  getMapSearchCenter?:()=>[number,number]|null
  className?: string
  type: EPointType
  onOpenMap: () => void
  extended?: boolean
  error?: string
  disabled?: boolean
  detailsAsDialog?: boolean
}

function LocationInput({
  language,
  from,
  to,
  locationClass,
  setFrom,
  setTo,
  className,
  type,
  onOpenMap,
  extended = false,
  error,
  disabled = false,
  detailsAsDialog = false,
  getMapSearchCenter,
}: IProps) {
  const point = type === EPointType.From ? from : to
  const setPoint = type === EPointType.From ? setFrom : setTo

  const [isAddressShort, setIsAddressShort] = useCachedState(
    `${cachedOrderDataStateKey}.is${EPointType[type]}AddressShort`,
    true,
  )
  const [searchActive,setSearchActive] = useState(false)
  const [detailsOpen,setDetailsOpen] = useState(false)
  const lastFromWithCoordinates = useRef<IAddressPoint | null>(hasCoordinates(from) ? from : null)
  const lastToWithCoordinates = useRef<IAddressPoint | null>(hasCoordinates(to) ? to : null)

  if (hasCoordinates(from))
    lastFromWithCoordinates.current = from
  if (hasCoordinates(to))
    lastToWithCoordinates.current = to

  const getSuggestionSearchCenter = () => {
    const camera=getMapSearchCenter?.() || MOROCCO_CENTER
    const mapCenter:IAddressPoint={latitude:camera[0],longitude:camera[1]}
    if (type === EPointType.To)
      return lastFromWithCoordinates.current || lastToWithCoordinates.current || mapCenter

    return hasCoordinates(point) ?
      point :
      lastFromWithCoordinates.current || lastToWithCoordinates.current || mapCenter
  }

  const suggestionSearchCenter = getSuggestionSearchCenter()
  const suggestionSearchCenterKey = suggestionSearchCenter ?
    `${Number(suggestionSearchCenter.latitude).toFixed(5)},${Number(suggestionSearchCenter.longitude).toFixed(5)}` :
    ''

  const getPointDisplayValue = () => {
    const address = point?.address || point?.shortAddress
    if (address) {
      if (!hasCoordinates(point)) return address
      const present = detailsAsDialog || isAddressShort ? displayShortAddress : displayAddress
      return present(address,language?.iso,point.latitude,point.longitude)
    }

    return ''
  }

  const locationClassData = SITE_CONSTANTS.BOOKING_LOCATION_CLASSES
    .find(({ id }) => id === locationClass)!
  const isIntercity = locationClassData.kind === EBookingLocationKinds.Intercity
  const typedQuery = String(point?.address || '')
  const {suggestions,status:searchStatus,retry}=useAddressSearch({
    query:searchActive&&!hasCoordinates(point)?typedQuery:'',
    contextKey:`${language?.iso}:${isIntercity}:${suggestionSearchCenterKey}`,
    search:query=>backendGateway.getPointSuggestions(query,isIntercity,suggestionSearchCenter),
  })

  const uiCopy = rideCopy(language?.iso)
  const rankedSuggestions=useMemo(()=>rankAddressSuggestions(typedQuery,suggestions),[typedQuery,suggestions])
  const searchCopy = journeyCopy(language?.iso)
  const pointLabel = type === EPointType.From ? uiCopy.pickup : uiCopy.destination
  const buttons: NonNullable<React.ComponentProps<typeof Input>['buttons']> = [
    {
      text: detailsAsDialog || isAddressShort ? uiCopy.expandAddress : uiCopy.collapseAddress,
      svg: <ChevronDown width={14} height={14} aria-hidden="true" style={{ transform: (detailsAsDialog ? detailsOpen : !isAddressShort) ? 'rotate(180deg)' : undefined }} />,
      title: detailsAsDialog || isAddressShort ? uiCopy.expandAddress : uiCopy.collapseAddress,
      'aria-label': `${detailsAsDialog || isAddressShort ? uiCopy.expandAddress : uiCopy.collapseAddress}: ${pointLabel}`,
      'aria-expanded': detailsAsDialog ? detailsOpen : !isAddressShort,
      wrapperProps: { className: 'rs-address-toggle-control' },
      className: 'rs-address-toggle-button',
      type: 'button',
      checkLogin: false,
      disabled,
      onClick: disabled ? undefined : () => detailsAsDialog ? setDetailsOpen(true) : setIsAddressShort(prev => !prev),
    },
    {
      svg: type===EPointType.From ? <LocateFixed size={20} aria-hidden="true"/> : <Flag size={20} aria-hidden="true"/>,
      'aria-label': `${uiCopy.onMap}: ${pointLabel}`,
      wrapperProps: { className: 'rs-map-pick-control' },
      className: 'rs-map-pick-button',
      type: 'button',
      checkLogin: false,
      disabled,
      onClick: disabled ? undefined : onOpenMap,
    },
  ]

  return (
    <>
    <Input
      floatingSuggestions
      fieldWrapperClassName={className}
      label={pointLabel}
      inputProps={{
        'aria-label': pointLabel,
        name: type === EPointType.From ? 'pickupAddress' : 'destinationAddress',
        autoComplete: 'off',
        placeholder: type === EPointType.From ? rideCopy(language?.iso).pickupSearch : rideCopy(language?.iso).destinationSearch,
        value: getPointDisplayValue(),
        disabled,
        readOnly: disabled,
        onFocus:()=>setSearchActive(true),
        onBlur:()=>setSearchActive(false),
        // Контракт для E2E: поля точек формы заказа пассажира.
        ...({
          'data-testid': type === EPointType.From ? 'passenger-order-from' : 'passenger-order-to',
        } as React.ComponentProps<'input'>),
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
          if (disabled) return
          setPoint({ address: e.target.value })
        },
        onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
          if (disabled) return
          if (e.key === 'Enter') {
            e.preventDefault()
            // Input selects only an explicitly highlighted result. Never geocode
            // the first ambiguous result simply because focus leaves the field.
          }
        },
      }}
      style={EInputStyles.RedDesign}
      error={error}
      buttons={
        point?.shortAddress ?
          buttons :
          buttons.slice(1)
      }
      suggestions={disabled ? [] : rankedSuggestions}
      getSuggestionLabel={item=>displayShortAddress(item.point?.address || item.point?.shortAddress,language?.iso,item.point?.latitude,item.point?.longitude)}
      expandedText={!detailsAsDialog && !isAddressShort ? point?.address : undefined}
      suggestionStatus={searchStatus}
      onRetrySuggestions={retry}
      suggestionLabels={{loading:searchCopy.searching,empty:searchCopy.noResults,error:searchCopy.searchError,personal:searchCopy.personal,shared:searchCopy.shared,map:searchCopy.map}}
      onSuggestionClick={(suggestion) => {
        if (disabled) return
        const selectedPoint = suggestion.point || null
        if (
          selectedPoint &&
          (selectedPoint.address || selectedPoint.shortAddress) &&
          !(selectedPoint.latitude && selectedPoint.longitude)
        ) {
          setPoint({
            ...selectedPoint,
            resolveAddress: true,
          })
          return
        }
        setPoint(selectedPoint)
      }}
    />
    {detailsAsDialog && <Overlay isOpen={detailsOpen} onClick={() => setDetailsOpen(false)}>
     <div className="modal ride-service-dialog ride-address-dialog">
      <h2>{searchCopy.addressDetails}: {pointLabel}</h2>
      <p dir="auto">{point?.address || point?.shortAddress}</p>
      <button type="button" onClick={() => setDetailsOpen(false)}>{uiCopy.done}</button>
     </div>
    </Overlay>}
    </>
  )
}

export default connector(LocationInput)
