import {localizationLanguage} from '../../localization/runtime'
import {serviceText} from '../../design/serviceText'
const copy={
 ru:{required:'Серверный эмулятор не настроен: нужны отдельный локальный тестовый сервер и тестовые аккаунты. Открытие панели не создаёт заказы.',demo:'Открыть демо без регистрации'},
 en:{required:'Server emulation is not configured: an isolated local test server and disposable accounts are required. Opening this panel does not create orders.',demo:'Open demo without registration'},
 fr:{required:'Émulation serveur non configurée : un serveur de test local isolé et des comptes de test sont requis. Ouvrir ce panneau ne crée pas de commandes.',demo:'Ouvrir la démo sans inscription'},
 ar:{required:'محاكي الخادم غير مهيأ: يلزم خادم اختبار محلي منفصل وحسابات اختبار. فتح هذه اللوحة لا ينشئ طلبات.',demo:'افتح العرض التجريبي دون تسجيل'}
}
const accountFileCopy = {
  ru: {loadAccounts: 'Загрузить JSON с тестовыми аккаунтами', invalidAccounts: 'Проверьте формат файла и наличие аккаунта для этой панели.'},
  en: {loadAccounts: 'Load test accounts JSON', invalidAccounts: 'Check the file format and include an account for this panel.'},
  fr: {loadAccounts: 'Charger les comptes de test (JSON)', invalidAccounts: 'Vérifiez le format du fichier et ajoutez un compte pour ce panneau.'},
  ar: {loadAccounts: 'تحميل حسابات الاختبار (JSON)', invalidAccounts: 'تحقق من تنسيق الملف وأضف حسابًا لهذه اللوحة.'},
}
export function emulatorAvailabilityCopy(){
  const lang=(localizationLanguage()?.iso||'en').toLowerCase().split('-')[0] as keyof typeof copy
  return {
    ...serviceText(copy[lang]||copy.en,'emulator_availability'),
    ...serviceText(accountFileCopy[lang]||accountFileCopy.en,'emulator_account_file'),
  }
}
