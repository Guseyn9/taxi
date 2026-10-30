import type { IAddressPoint } from '../../types/types'
import type { ZoneCheckStatus } from '../../state/clientOrder/constants'

export function hasZoneCoordinates(point: IAddressPoint | null | undefined): boolean {
  return typeof point?.latitude === 'number' && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90 &&
    typeof point?.longitude === 'number' && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180
}

export function zoneCheckState(point: IAddressPoint | null | undefined, status: ZoneCheckStatus): ZoneCheckStatus {
  return hasZoneCoordinates(point) ? status : 'idle'
}

export function zoneChecksReady(state: {
  from: IAddressPoint | null, to: IAddressPoint | null,
  fromZoneStatus: ZoneCheckStatus, toZoneStatus: ZoneCheckStatus,
  fromPolygons: string[] | null, toPolygons: string[] | null,
}): boolean {
  return hasZoneCoordinates(state.from) && hasZoneCoordinates(state.to) &&
    state.fromZoneStatus === 'ready' && state.toZoneStatus === 'ready' &&
    Array.isArray(state.fromPolygons) && Array.isArray(state.toPolygons)
}

export function retryZonePoint(point: IAddressPoint) {
  // The retry rechecks the selected address; it must never ask for GPS again.
  return { ...point, isCurrent: false, resolveAddress: false }
}

export function zoneCheckCopy(iso = 'en') {
  if (iso.startsWith('ru')) return {
    from: 'Зона подачи', to: 'Зона назначения', checking: 'Проверяем зону…',
    error: 'Не удалось проверить зону. Проверьте связь и повторите.', retry: 'Повторить',
    blocked: 'Дождитесь проверки зон обоих адресов. Если проверка не удалась, повторите её.',
  }
  if (iso.startsWith('fr')) return {
    from: 'Zone de départ', to: 'Zone de destination', checking: 'Vérification de la zone…',
    error: 'Impossible de vérifier la zone. Vérifiez la connexion et réessayez.', retry: 'Réessayer',
    blocked: 'Attendez la vérification des deux zones. En cas d’échec, réessayez.',
  }
  if (iso.startsWith('ar')) return {
    from: 'منطقة الانطلاق', to: 'منطقة الوصول', checking: 'جارٍ التحقق من المنطقة…',
    error: 'تعذر التحقق من المنطقة. تحقق من الاتصال وحاول مجدداً.', retry: 'إعادة المحاولة',
    blocked: 'انتظر التحقق من منطقتي العنوانين. أعد المحاولة إذا فشل التحقق.',
  }
  return {
    from: 'Pickup zone', to: 'Destination zone', checking: 'Checking the zone…',
    error: 'Could not check the zone. Check your connection and try again.', retry: 'Retry',
    blocked: 'Wait for both address zones to be checked. If a check fails, retry it.',
  }
}
