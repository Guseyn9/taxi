/**
 * Гео-примитивы без зависимостей.
 *
 * Формула жила в `tools/utils.ts`, а тот тянет за собой локализацию и через неё
 * весь redux-граф приложения. Расстояние между точками нужно и модулям, которые
 * обязаны оставаться юнит-тестируемыми (матрица Decision Log), — поэтому оно
 * вынесено в отдельный лист дерева зависимостей. `utils.ts` реэкспортирует его,
 * так что прежние места импорта не меняются.
 */

export const degreesToRadians = (degrees: number): number => {
  return degrees * Math.PI / 180
}

/** Расстояние по большому кругу между двумя точками, в километрах. */
export const distanceBetweenEarthCoordinates = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number => {
  const earthRadiusKm = 6371

  let dLat = degreesToRadians(lat2-lat1),
    dLon = degreesToRadians(lon2-lon1)

  lat1 = degreesToRadians(lat1)
  lat2 = degreesToRadians(lat2)

  let a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.sin(dLon/2) * Math.sin(dLon/2) * Math.cos(lat1) * Math.cos(lat2),
    c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  return earthRadiusKm * c
}
