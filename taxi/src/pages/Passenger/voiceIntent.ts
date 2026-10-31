/** Confirmation is an explicit command, never a word found inside a sentence. */
export function normalizedVoiceCommand(text:string){return text.toLocaleLowerCase().replace(/[.,!?;:،؟]/g,' ').replace(/\s+/g,' ').trim()}
const confirmations=new Set(['да','да подтверждаю','подтверждаю','заказать','верно','oui','confirmer','yes','confirm','order','sí','confirmar','نعم','أؤكد','اطلب'])
const rejections=new Set(['нет','не надо','не подтверждаю','отмена','отбой','non','annuler','no','cancel','do not confirm','no confirmar','لا','إلغاء'])
export function isConfirmation(text:string){return confirmations.has(normalizedVoiceCommand(text))}
export function isRejection(text:string){return rejections.has(normalizedVoiceCommand(text))}
