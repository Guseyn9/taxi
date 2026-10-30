import {terminalBooking} from './rideData'
import {EBookingStates} from '../../types/types'
const copy={ru:{completed:'Завершён',canceled:'Отменён',duration:'Расчётная длительность маршрута'},en:{completed:'Completed',canceled:'Cancelled',duration:'Estimated route duration'},fr:{completed:'Terminé',canceled:'Annulé',duration:'Durée estimée du trajet'},ar:{completed:'مكتمل',canceled:'ملغى',duration:'المدة التقديرية للمسار'}}
export function cardPresentation(order:any,iso?:string){
 const words=copy[(iso||'en').split('-')[0] as keyof typeof copy]||copy.en
 const terminal=terminalBooking(order)
 return {terminal,label:terminal?(Number(order?.b_state)===EBookingStates.Canceled||order?.b_canceled?words.canceled:words.completed):undefined,duration:words.duration}
}
