import React, { useSyncExternalStore } from 'react'
import { RefreshCw, Clock3 } from 'lucide-react'
import { DriverCommandRecovery } from '../../platform/adapters/DriverCommandRecovery'
import { serviceText } from '../../design/serviceText'
import './styles.css'

const empty: readonly never[] = Object.freeze([])
const noSubscribe = () => () => undefined
const noSnapshot = () => empty
export function useDriverCommandRecovery(controller: DriverCommandRecovery | null, userId?: string | number) {
  const records = useSyncExternalStore(controller?.subscribe || noSubscribe, controller?.getSnapshot || noSnapshot)
  return userId !== undefined && controller?.belongsTo(userId) ? records : empty
}
const words = {
  ru: {checking:'Проверяем предыдущее действие',unknown:'Результат действия ещё не подтверждён',order:'Заказ',hint:'Новое действие по этому заказу будет доступно после проверки.',retry:'Проверить результат',storage:'Не закрывайте страницу: браузер не сохранил ожидание действия.'},
  en: {checking:'Checking your previous action',unknown:'The action result is not confirmed yet',order:'Order',hint:'Another action for this order will be available after verification.',retry:'Check result',storage:'Keep this page open: the browser could not save the pending action.'},
  fr: {checking:'Vérification de l’action précédente',unknown:'Le résultat de l’action n’est pas encore confirmé',order:'Commande',hint:'Une nouvelle action sera disponible après vérification.',retry:'Vérifier le résultat',storage:'Gardez cette page ouverte : le navigateur n’a pas enregistré l’action en attente.'},
  ar: {checking:'جارٍ التحقق من الإجراء السابق',unknown:'لم يتم تأكيد نتيجة الإجراء بعد',order:'الطلب',hint:'سيتاح إجراء آخر لهذا الطلب بعد التحقق.',retry:'تحقق من النتيجة',storage:'أبقِ الصفحة مفتوحة: تعذر على المتصفح حفظ الإجراء المعلّق.'},
}
export default function DriverCommandRecoveryNotice({controller,userId,iso}:{controller:DriverCommandRecovery|null,userId?:string|number,iso?:string}) {
  const records=useDriverCommandRecovery(controller,userId)
  const visible=records.filter(item=>item.restored || item.phase==='unconfirmed' || !item.durable)
  const base=(iso||'en').toLowerCase().split(/[-_]/)[0]
  const outcomes={ru:{completed:'Действие выполнено',failed:'Действие не выполнено',refresh:'Обновляем данные заказа.',close:'Понятно'},en:{completed:'Action completed',failed:'Action failed',refresh:'Refreshing order details.',close:'Dismiss'},fr:{completed:'Action effectuée',failed:'Action non effectuée',refresh:'Actualisation de la commande.',close:'Fermer'},ar:{completed:'تم تنفيذ الإجراء',failed:'لم يتم تنفيذ الإجراء',refresh:'جارٍ تحديث بيانات الطلب.',close:'إغلاق'}}
  const copy=serviceText({...words[base as keyof typeof words]||words.en,...outcomes[base as keyof typeof outcomes]||outcomes.en},'command_recovery')
  if(!visible.length)return null
  return <aside className="command-recovery" aria-label={copy.checking} data-testid="command-recovery">
    {visible.map(item=><div className="command-recovery__item" key={item.instanceId} aria-busy={item.phase==='checking'}>
      <Clock3 size={20} aria-hidden="true"/>
      <div className="command-recovery__text" role="status" aria-live="polite"><strong>{copy.order} №{item.orderId}: {item.phase==='checking'?copy.checking:item.phase==='unconfirmed'?copy.unknown:copy[item.phase]}</strong><span>{item.phase==='completed'||item.phase==='failed'?copy.refresh:!item.durable?copy.storage:copy.hint}</span></div>
      {item.phase==='unconfirmed'&&<button type="button" onClick={()=>controller?.retry(item.instanceId)}><RefreshCw size={17} aria-hidden="true"/>{copy.retry}</button>}
      {(item.phase==='completed'||item.phase==='failed')&&<button type="button" onClick={()=>controller?.dismiss(item.instanceId)}>{copy.close}</button>}
    </div>)}
  </aside>
}
