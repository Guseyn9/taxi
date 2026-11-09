import {localizationLanguage} from '../../localization/runtime'
import {serviceText} from '../../design/serviceText'
const copy={
 ru:{required:'Серверный эмулятор не настроен: нужны отдельный локальный тестовый сервер и тестовые аккаунты. Открытие панели не создаёт заказы.',demo:'Открыть демо без регистрации'},
 en:{required:'Server emulation is not configured: an isolated local test server and disposable accounts are required. Opening this panel does not create orders.',demo:'Open demo without registration'},
 fr:{required:'Émulation serveur non configurée : un serveur de test local isolé et des comptes de test sont requis. Ouvrir ce panneau ne crée pas de commandes.',demo:'Ouvrir la démo sans inscription'},
 ar:{required:'محاكي الخادم غير مهيأ: يلزم خادم اختبار محلي منفصل وحسابات اختبار. فتح هذه اللوحة لا ينشئ طلبات.',demo:'افتح العرض التجريبي دون تسجيل'}
}
export function emulatorAvailabilityCopy(){const lang=(localizationLanguage()?.iso||'en').toLowerCase().split('-')[0] as keyof typeof copy;return serviceText(copy[lang]||copy.en,'emulator_availability')}
