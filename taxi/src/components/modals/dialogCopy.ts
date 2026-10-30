export function dialogCopy(iso?: string) {
  if (iso?.startsWith('ru')) return { showPassword: 'Показать пароль', hidePassword: 'Скрыть пароль', send: 'Отправить сообщение', message: 'Напишите сообщение', you: 'Вы', chat: 'Чат по поездке' }
  if (iso?.startsWith('fr')) return { showPassword: 'Afficher le mot de passe', hidePassword: 'Masquer le mot de passe', send: 'Envoyer le message', message: 'Écrivez un message', you: 'Vous', chat: 'Discussion du trajet' }
  if (iso?.startsWith('ar')) return { showPassword: 'إظهار كلمة المرور', hidePassword: 'إخفاء كلمة المرور', send: 'إرسال الرسالة', message: 'اكتب رسالة', you: 'أنت', chat: 'محادثة الرحلة' }
  return { showPassword: 'Show password', hidePassword: 'Hide password', send: 'Send message', message: 'Write a message', you: 'You', chat: 'Ride chat' }
}
