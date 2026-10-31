import {serviceText} from './serviceText'
const copy={
 ru:{order:'По расчётной цене',vote:'Кто приедет первым',offer:'Предложить сумму'},
 en:{order:'Calculated fare',vote:'First taxi to arrive',offer:'Suggest your fare'},
 fr:{order:'Prix calculé',vote:'Premier taxi arrivé',offer:'Proposer un prix'},
 ar:{order:'الأجرة المحسوبة',vote:'أول سيارة تصل',offer:'اقترح أجرتك'}
}
export function bookingActionCopy(iso?:string){const lang=(iso||'en').toLowerCase().split('-')[0] as keyof typeof copy;return serviceText(copy[lang]||copy.en,'booking_action_detail')}
