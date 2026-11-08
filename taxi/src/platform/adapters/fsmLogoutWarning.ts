import { getSessionRecoveryId } from '../../security/sessionTokens'

/** Warn before revoking the Core session used by accepted or uncertain writes. */
export function confirmFsmLogout(): boolean {
  const session = getSessionRecoveryId()
  if (!session) return true
  let pending = false
  try {
    const passenger = JSON.parse(sessionStorage.getItem('taxi.passenger.fsm-pending.v1') || 'null')
    const driver = JSON.parse(sessionStorage.getItem('taxi.driver.pending-commands.v1') || 'null')
    pending = passenger?.session === session || (driver?.scope?.sessionId === session && driver.commands?.length > 0)
  } catch { return true }
  if (!pending) return true
  const words = {
    ru: 'Результат операции ещё не подтверждён. Выход может прервать её проверку или привести к отказу. После повторного входа проверьте заказ перед новой отправкой. Выйти?',
    en: 'An action is still unconfirmed. Signing out may interrupt its checks or cause it to fail. After signing in again, check the order before submitting again. Sign out?',
    fr: 'Une action reste non confirmée. La déconnexion peut interrompre sa vérification ou la faire échouer. Après reconnexion, vérifiez la commande avant un nouvel envoi. Se déconnecter ?',
    ar: 'لم يتم تأكيد نتيجة العملية بعد. قد يؤدي تسجيل الخروج إلى إيقاف التحقق منها أو فشلها. بعد تسجيل الدخول مجددًا، تحقق من الطلب قبل الإرسال مرة أخرى. هل تريد تسجيل الخروج؟',
  }
  const language = document.documentElement.lang.toLowerCase().split(/[-_]/)[0]
  return window.confirm(words[language as keyof typeof words] || words.en)
}
