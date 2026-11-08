import React, { useEffect, useState } from 'react'
import { connect, ConnectedProps } from 'react-redux'
import { carsSelectors, carsActionCreators } from '../../state/cars'
import { IRootState } from '../../state'
import { t, TRANSLATION } from '../../localization'
import { getCarCapacity } from '../../tools/driverCapacity'

const connector = connect((state: IRootState) => ({
  cars: carsSelectors.userCars(state)?.map(item => item?.value).filter(Boolean).toArray(),
  active: carsSelectors.userDrivenCar(state),
}), { activate: carsActionCreators.activateVehicle, refresh: carsActionCreators.getUserCars })

export function ActiveVehiclePicker({ cars, active, activate, refresh }: ConnectedProps<typeof connector>) {
  const [selected, setSelected] = useState(''), [pending, setPending] = useState(false), [error, setError] = useState('')
  useEffect(() => { setSelected(active ? String(active.c_id) : '');setError('') }, [active?.c_id])
  const choose = async () => {
    const car = cars?.find(item => String(item?.c_id) === selected)
    if (!car || pending) return
    setPending(true);setError('')
    try { await activate(car) } catch { setError(t('driver_vehicle_reconcile', {fallback:'Vehicle not confirmed. Refresh the list and check the active vehicle.'})) }
    finally { setPending(false) }
  }
  if (!cars) return <p role="status">{t(TRANSLATION.LOADING)}</p>
  return <section className="driver-vehicle-picker" aria-label={t('driver_vehicle', {fallback:'Vehicle'})}>
    <label>{t('driver_vehicle', {fallback:'Vehicle'})} <select value={selected} disabled={pending} onChange={event => setSelected(event.target.value)}>
      <option value="">{t('driver_select_vehicle', {fallback:'Choose a vehicle'})}</option>
      {cars.map(car => car && <option key={car.c_id} value={String(car.c_id)}>{car.registration_plate || car.c_id}</option>)}
    </select></label>
    <button type="button" disabled={!selected || pending || String(active?.c_id) === selected} onClick={choose}>{pending ? t(TRANSLATION.LOADING) : t('driver_activate_vehicle', {fallback:'Use this vehicle'})}</button>
    <button type="button" disabled={pending} onClick={() => refresh()}>{t('refresh', {fallback:'Refresh'})}</button>
    {active && getCarCapacity(active) === 0 && <p role="alert">{t('driver_vehicle_capacity_unknown', {fallback:'Vehicle capacity is missing. New orders are unavailable until it is verified.'})}</p>}
    {error && <p role="alert">{error}</p>}
  </section>
}
export default connector(ActiveVehiclePicker)
