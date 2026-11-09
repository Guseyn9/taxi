import './styles.scss'
import React, { useEffect, useState } from 'react'
import { connect, ConnectedProps } from 'react-redux'
import { carsSelectors, carsActionCreators } from '../../state/cars'
import { IRootState } from '../../state'
import { t, TRANSLATION } from '../../localization'
import { configSelectors } from '../../state/config'
import { vehiclePickerCopy } from './copy'
import { getCarCapacity } from '../../tools/driverCapacity'

const connector = connect((state: IRootState) => ({
  cars: carsSelectors.userCars(state)?.map(item => item?.value).filter(Boolean).toArray(),
  active: carsSelectors.userDrivenCar(state),
  iso: configSelectors.language(state)?.iso,
}), { activate: carsActionCreators.activateVehicle, refresh: carsActionCreators.getUserCars })

export function ActiveVehiclePicker({ cars, active, activate, refresh, iso }: ConnectedProps<typeof connector>) {
  const copy = vehiclePickerCopy(iso)
  const [selected, setSelected] = useState(''), [pending, setPending] = useState(false), [error, setError] = useState('')
  useEffect(() => { setSelected(active ? String(active.c_id) : '');setError('') }, [active?.c_id])
  const choose = async () => {
    const car = cars?.find(item => String(item?.c_id) === selected)
    if (!car || pending) return
    setPending(true);setError('')
    try { await activate(car) } catch { setError(copy.unconfirmed) }
    finally { setPending(false) }
  }
  if (!cars) return <p role="status">{t(TRANSLATION.LOADING)}</p>
  return <section className="driver-vehicle-picker" aria-label={copy.vehicle}>
    <label>{copy.vehicle} <select value={selected} disabled={pending} onChange={event => setSelected(event.target.value)}>
      <option value="">{copy.choose}</option>
      {cars.map(car => car && <option key={car.c_id} value={String(car.c_id)}>{car.registration_plate || car.c_id}</option>)}
    </select></label>
    <button type="button" disabled={!selected || pending || String(active?.c_id) === selected} onClick={choose}>{pending ? t(TRANSLATION.LOADING) : copy.activate}</button>
    <button type="button" disabled={pending} onClick={() => refresh()}>{copy.refresh}</button>
    {active && getCarCapacity(active) === 0 && <p role="alert">{copy.unknown}</p>}
    {error && <p role="alert">{error}</p>}
  </section>
}
export default connector(ActiveVehiclePicker)
