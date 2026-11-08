import React from 'react'
import {t, TRANSLATION} from '../localization'
import {EBookingDriverState, IDriver, IOrder} from '../types/types'

/** A booking PIN is server data. Vehicle/door numbers must never substitute it. */
export default function PassengerBoardingCode({order, driver, className}: {order?:IOrder|null;driver?:IDriver|null;className:string}) {
  const code = String(order?.b_driver_code ?? '').trim()
  if (!driver || !code || [EBookingDriverState.Started,EBookingDriverState.Finished,EBookingDriverState.Canceled].includes(driver.c_state!)) return null
  return <div className={className}><span>{t(TRANSLATION.CLIENT_BOARDING_CODE)}</span><strong data-testid="passenger-boarding-code">{code}</strong></div>
}
