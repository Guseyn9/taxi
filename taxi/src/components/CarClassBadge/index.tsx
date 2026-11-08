import React from 'react'
import cn from 'classnames'
import SITE_CONSTANTS from '../../siteConstants'
import { t, TRANSLATION } from '../../localization'
import { ICar, IOrder } from '../../types/types'
import { isIntercityOrderLocationClass } from '../../tools/driverOffer'
import VehicleArtwork from '../CarClassSlider/VehicleArtwork'
import {taxiColor} from '../../design/maps/taxiPalette'
import './styles.scss'

export type CarClassBadgeKind = 'petit' | 'grand'

function normalizeText(value?: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

function getClassNameFromId(classId?: unknown) {
  if (classId === null || classId === undefined || classId === '')
    return ''

  const carClass = SITE_CONSTANTS.CAR_CLASSES[String(classId)] as any
  return normalizeText([
    TRANSLATION.CAR_CLASSES[String(classId)] ? t(TRANSLATION.CAR_CLASSES[String(classId)]) : '',
    carClass?.name,
    carClass?.title,
    carClass?.label,
    carClass?.code,
    carClass?.type,
    carClass?.id,
    classId,
  ].filter(Boolean).join(' '))
}

export function getKindFromClassId(classId?: unknown): CarClassBadgeKind | null {
  const text = getClassNameFromId(classId)
  if (!text)
    return null

  if (text.includes('grand') || text.includes('grande') || text.includes('гранд'))
    return 'grand'

  if (text.includes('petit') || text.includes('petti') || text.includes('петит') || text.includes('econom') || text.includes('эконом'))
    return 'petit'

  return null
}

/** Booking artwork follows the class card's existing fallback; this does not classify a real driver's car. */
export function getClassArtworkKind(classId?: unknown): CarClassBadgeKind {
  if (classId === null || classId === undefined || classId === '' || String(classId) === '0')
    return 'petit'

  return getKindFromClassId(classId) || 'grand'
}

export function getRequiredCarClassKind(order?: IOrder | null): CarClassBadgeKind {
  if (!order)
    return 'petit'

  const byClass = getKindFromClassId(order.b_car_class)
  if (byClass)
    return byClass

  if (isIntercityOrderLocationClass(order.b_location_class))
    return 'grand'

  return 'petit'
}

export function getCandidateCarClassKind(car?: ICar | null, order?: IOrder | null): CarClassBadgeKind {
  const byCar = getKindFromClassId(car?.cc_id)
  if (byCar)
    return byCar

  return getRequiredCarClassKind(order)
}

interface IProps {
  kind: CarClassBadgeKind
  className?: string
  compact?: boolean
  point?: readonly number[] | null
}

export default function CarClassBadge({ kind, className, compact, point }: IProps) {
  const label = kind === 'grand' ? 'GRAND' : 'PETIT'
  const color=taxiColor({point,kind,palette:SITE_CONSTANTS.PALETTE?.primary?.main})

  return (
    <span className={cn('car-class-badge', `car-class-badge--${kind}`, { 'car-class-badge--compact': compact }, className)} aria-label={label}>
      <VehicleArtwork kind={kind} color={color} className="car-class-badge__image"/><small>{label}</small>
    </span>
  )
}
