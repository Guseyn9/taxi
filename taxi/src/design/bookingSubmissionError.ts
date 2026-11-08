import {serviceText} from './serviceText'
import {isAmbiguousMutationError} from '../tools/mutationReadback'

const words = {
  ru: {settings: 'Настройки операций изменены или недоступны. Новое действие не отправлено. Повторите попытку.', offer: 'Сервис не принял предложение. Сумма сохранена. Проверьте параметры поездки и попробуйте снова.',
    order: 'Сервис не принял заказ. Проверьте параметры поездки и попробуйте снова.',
    unknown: 'Результат отправки не подтверждён. Проверьте список заказов перед повторной отправкой: запрос мог дойти до сервера.',
    phone: 'Укажите корректный телефон в параметрах поездки.', auth: 'Войдите в аккаунт перед отправкой заказа.',
    point: 'Подтвердите «Откуда» и «Куда» из подсказок или на карте.', refresh: 'Проверить заказы', newRequest:'Начать новый заказ',
    review:'Сначала проверьте список заказов. Если первый заказ уже появился, откройте его. Новый запрос может создать второй заказ при задержке сервера.', cancel:'Назад'},
  en: {settings: 'Operation settings changed or are unavailable. No new action was sent. Please retry.', offer: 'The service did not accept the fare offer. Your amount is saved. Check trip options and try again.',
    order: 'The service did not accept the booking. Check trip options and try again.',
    unknown: 'The submission result is unconfirmed. Check your orders before sending again: the request may have reached the server.',
    phone: 'Enter a valid phone in trip options.', auth: 'Sign in before sending your booking.',
    point: 'Confirm pickup and destination from suggestions or on the map.', refresh: 'Check orders', newRequest:'Start a new booking',
    review:'Check your orders first. If the first booking appeared, open it. A new request may create a second booking if the server is delayed.', cancel:'Back'},
  fr: {settings: 'Les réglages des opérations ont changé ou sont indisponibles. Aucune nouvelle action envoyée. Réessayez.', offer: 'Le service a refusé l’offre. Le montant est conservé. Vérifiez les options et réessayez.',
    order: 'Le service a refusé la réservation. Vérifiez les options et réessayez.',
    unknown: 'Envoi non confirmé. Consultez vos commandes avant de renvoyer : la demande a peut-être atteint le serveur.',
    phone: 'Indiquez un téléphone valide dans les options.', auth: 'Connectez-vous avant d’envoyer la demande.',
    point: 'Confirmez le départ et la destination dans les résultats ou sur la carte.', refresh: 'Vérifier les commandes', newRequest:'Nouvelle réservation',
    review:'Vérifiez vos commandes. Si la première apparaît, ouvrez-la. Une nouvelle demande peut créer une seconde commande si le serveur tarde.', cancel:'Retour'},
  ar: {settings: 'تغيرت إعدادات العمليات أو تعذر تحميلها. لم يتم إرسال عملية جديدة. حاول مجددًا.', offer: 'لم تقبل الخدمة عرض الأجرة. تم الاحتفاظ بالمبلغ. تحقق من خيارات الرحلة وحاول مجدداً.',
    order: 'لم تقبل الخدمة الطلب. تحقق من خيارات الرحلة وحاول مجدداً.',
    unknown: 'لم تتأكد نتيجة الإرسال. تحقق من طلباتك قبل الإرسال مجدداً؛ ربما وصل الطلب إلى الخادم.',
    phone: 'أدخل هاتفاً صالحاً في خيارات الرحلة.', auth: 'سجل الدخول قبل إرسال الطلب.',
    point: 'أكد نقطة الانطلاق والوجهة من النتائج أو الخريطة.', refresh: 'تحقق من الطلبات', newRequest:'بدء طلب جديد',
    review:'تحقق من طلباتك أولاً. إذا ظهر الطلب الأول فافتحه. قد يؤدي طلب جديد إلى حجز ثانٍ إذا تأخر الخادم.', cancel:'رجوع'},
}
export function bookingErrorCopy(iso?: string) {
  const language = (iso || 'en').split(/[-_]/)[0] as keyof typeof words
  return serviceText(words[language] || words.en, 'booking_submit')
}
/** Classify known failures; raw API messages may contain private request data. */
export function bookingSubmissionError(error: unknown, mode: 'order'|'offer'|'vote', iso?: string) {
  const copy = bookingErrorCopy(iso), value = error as any
  if (['FSM_FEATURE_FLAGS_UNAVAILABLE','FSM_INTENT_DISABLED'].includes(value?.code)) return copy.settings
  const message = String(value?.message || '').toLowerCase()
  if (/unauthorized|auth failed/.test(message) || ['FSM_COMMAND_HTTP_401','AUTHORIZATION_FAILED'].includes(value?.code)) return copy.auth
  if (/point from select field/.test(message)) return copy.point
  const details = value?.response?.data || value?.details || value
  const rejected = ['CORE_REJECTED','INVALID_PARAMETERS','INVALID_TRANSITION','FSM_COMMAND_HTTP_400','FSM_COMMAND_HTTP_403'].includes(value?.code) || details?.status === 'error' || value?.code === 'BACKEND_RESPONSE_ERROR' ||
    (details?.code != null && /^4\d\d$/.test(String(details.code)))
  if (isAmbiguousMutationError(error) || !rejected) return copy.unknown
  return mode === 'offer' ? copy.offer : copy.order
}
export function bookingSubmissionUnconfirmed(error: unknown): boolean {
  if (['FSM_FEATURE_FLAGS_UNAVAILABLE','FSM_INTENT_DISABLED'].includes((error as any)?.code)) return false
  const value = error as any, message = String(value?.message || '').toLowerCase()
  if (['CORE_REJECTED','INVALID_PARAMETERS','INVALID_TRANSITION','AUTHORIZATION_FAILED','FSM_COMMAND_HTTP_400','FSM_COMMAND_HTTP_401','FSM_COMMAND_HTTP_403'].includes(value?.code)) return false
  if (/unauthorized|auth failed|point from select field/.test(message)) return false
  const details = value?.response?.data || value?.details || value
  if (isAmbiguousMutationError(error)) return true
  return !(details?.status === 'error' || value?.code === 'BACKEND_RESPONSE_ERROR' ||
    (details?.code != null && /^4\d\d$/.test(String(details.code))))
}
