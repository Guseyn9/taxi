const text = {
  en: { retry: 'Reconnect', connecting: 'Connecting to chat…', ready: 'Chat connected', error: 'Chat connection unavailable. Your message may not have been sent.', pending: 'Waiting for server confirmation…', unconfirmed: 'Sending has not been confirmed.', confirmed: 'Server confirmed the message.', failed: 'Message was not sent. Your text is saved.', restore: 'Return text to message field', retained: 'Saved message text' },
  ru: { retry: 'Подключиться снова', connecting: 'Подключение к чату…', ready: 'Чат подключён', error: 'Соединение с чатом недоступно. Сообщение могло не отправиться.', pending: 'Ожидание подтверждения сервера…', unconfirmed: 'Отправка не подтверждена.', confirmed: 'Сервер подтвердил сообщение.', failed: 'Сообщение не отправлено. Текст сохранён.', restore: 'Вернуть текст в поле сообщения', retained: 'Сохранённый текст сообщения' },
  fr: { retry: 'Reconnecter', connecting: 'Connexion au chat…', ready: 'Chat connecté', error: 'Connexion au chat indisponible. Le message n’a peut-être pas été envoyé.', pending: 'En attente de confirmation du serveur…', unconfirmed: 'L’envoi n’est pas confirmé.', confirmed: 'Le serveur a confirmé le message.', failed: 'Message non envoyé. Le texte est conservé.', restore: 'Remettre le texte dans le message', retained: 'Texte du message conservé' },
  ar: { retry: 'إعادة الاتصال', connecting: 'جارٍ الاتصال بالمحادثة…', ready: 'تم الاتصال بالمحادثة', error: 'الاتصال بالمحادثة غير متاح. ربما لم يتم إرسال الرسالة.', pending: 'في انتظار تأكيد الخادم…', unconfirmed: 'لم يتم تأكيد الإرسال.', confirmed: 'أكد الخادم الرسالة.', failed: 'لم يتم إرسال الرسالة. النص محفوظ.', restore: 'إعادة النص إلى حقل الرسالة', retained: 'نص الرسالة المحفوظ' },
}
export function chatStatusCopy(iso?: string) {
  const language = (iso || '').toLowerCase()
  return language.includes('arab') ? text.ar : text[language.split('-')[0] as keyof typeof text] || text.en
}
