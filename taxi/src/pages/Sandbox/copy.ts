const copy = {
  en: { open: 'Open JSON', save: 'Save', refresh: 'Refresh preview', invalid: 'Could not open these settings. Choose a valid JSON object.', readError: 'Could not read the file.' },
  ru: { open: 'Открыть JSON', save: 'Сохранить', refresh: 'Обновить просмотр', invalid: 'Не удалось открыть настройки. Выберите корректный JSON-объект.', readError: 'Не удалось прочитать файл.' },
  fr: { open: 'Ouvrir JSON', save: 'Enregistrer', refresh: 'Actualiser l’aperçu', invalid: 'Impossible d’ouvrir ces paramètres. Choisissez un objet JSON valide.', readError: 'Impossible de lire le fichier.' },
  ar: { open: 'افتح JSON', save: 'احفظ', refresh: 'حدّث المعاينة', invalid: 'تعذر فتح الإعدادات. اختر كائن JSON صالحاً.', readError: 'تعذرت قراءة الملف.' },
}
export function sandboxCopy(iso?: string) {
  const value = (iso || '').toLowerCase()
  return value.includes('arab') ? copy.ar : copy[value.split('-')[0] as keyof typeof copy] || copy.en
}
export function parseSandboxSettings(value: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch { return null }
}
