import {serviceText} from '../serviceText'
import {rideCopy} from '../copy'
const copy={
 ru:{pickup:'Подать сюда',destination:'Ехать сюда',center:'Точка под меткой'},
 en:{pickup:'Pick up here',destination:'Drop off here',center:'Point under the marker'},
 fr:{pickup:'Départ ici',destination:'Arrivée ici',center:'Point sous le repère'},
 ar:{pickup:'الانطلاق من هنا',destination:'الوصول إلى هنا',center:'النقطة تحت العلامة'}
}
export function mapActionCopy(iso?:string){
 const lang=(iso||'en').toLowerCase().split('-')[0] as keyof typeof copy
 const labels=serviceText(copy[lang]||copy.en,'map_action_ui')
 const fields=rideCopy(iso)
 return {...labels,pickup:fields.pickup,destination:fields.destination}
}
