import React, { useEffect, useRef, useState } from 'react'
import type { IAddressPoint } from '../../types/types'
import { passengerGateway } from '../../platform/adapters/LegacyPassengerGateway'
import { platformInterface } from '../../platform/platform-interface'
import { BrowserVoiceChannel, VOICE_TRANSCRIPT_RECEIVED } from '../../platform/voice-channel/BrowserVoiceChannel'
import './passenger-voice.scss'

type VoiceStep = 'idle' | 'pickup' | 'destination' | 'confirmation' | 'submitting'

const VoiceIcon: React.FC<{ muted?: boolean }> = ({ muted = false }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {muted ? (
      <>
        <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
        <path d="M15 9.34V5a3 3 0 0 0-5.83-.9" />
        <path d="M19 12a7 7 0 0 1-.5 2.6" />
        <path d="M5 12a7 7 0 0 0 11.95 4.95" />
        <path d="M12 19v3" />
        <path d="M8 22h8" />
        <path d="m2 2 20 20" />
      </>
    ) : (
      <>
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 10v2a7 7 0 0 0 14 0v-2" />
        <path d="M12 19v3" />
        <path d="M8 22h8" />
      </>
    )}
  </svg>
)

interface IProps {
  languageIso?: string
  getMapSearchCenter: () => [number, number] | null
  setFrom: (point: IAddressPoint) => unknown
  setTo: (point: IAddressPoint) => unknown
  onSubmitOrder: () => Promise<boolean>
}

interface IVoiceCopy {
  start: string
  stop: string
  ready: string
  submitting: string
  pickup: string
  destination: string
  confirmation: string
  success: string
  validation: string
  cancelled: string
  addressNotFound: string
  currentLocationUnavailable: string
  unsupported: string
  noSpeech: string
  failed: string
  switchToText: string
  switchToVoice: string
  send: string
}

const VOICE_COPY: Record<string, IVoiceCopy> = {
  ru: {
    start: 'Заказать голосом',
    stop: 'Остановить',
    ready: 'Голосовой заказ готов',
    submitting: 'Оформляю заказ.',
    pickup: 'Назовите адрес подачи или скажите «отсюда».',
    destination: 'Куда вас отвезти? Назовите адрес назначения.',
    confirmation: 'Проверьте точки подачи и назначения на карте. Если всё верно, скажите «подтверждаю».',
    success: 'Заказ отправлен. Информация о поездке отображается на экране.',
    validation: 'Заказ пока не отправлен. Проверьте обязательные поля и доступность зоны на экране, затем скажите «подтверждаю».',
    cancelled: 'Голосовое оформление остановлено. Заказ не создан.',
    addressNotFound: 'Не удалось найти этот адрес. Повторите адрес или выберите точку на карте.',
    currentLocationUnavailable: 'Не удалось определить ваше местоположение. Разрешите доступ к геолокации или назовите адрес.',
    unsupported: 'В этом браузере голосовой ввод не поддерживается. Используйте поля заказа на экране.',
    noSpeech: 'Не удалось распознать речь. Нажмите кнопку и повторите.',
    failed: 'Ошибка голосового ввода. Попробуйте ещё раз или используйте экран.',
    switchToText: 'Ввести текстом', switchToVoice: 'Вернуться к голосу', send: 'Отправить',
  },
  fr: {
    start: 'Commander à la voix',
    stop: 'Arrêter',
    ready: 'Commande vocale prête',
    submitting: 'J’envoie votre commande.',
    pickup: 'Indiquez le lieu de prise en charge ou dites « ici ».',
    destination: 'Quelle est votre destination ?',
    confirmation: 'Vérifiez les deux points sur la carte. Si tout est correct, dites « confirmer ».',
    success: 'La commande a été envoyée. Les détails du trajet sont affichés à l’écran.',
    validation: 'La commande n’a pas été envoyée. Vérifiez les champs obligatoires et la zone sur l’écran, puis dites « confirmer ».',
    cancelled: 'La commande vocale est arrêtée. Aucune course n’a été créée.',
    addressNotFound: 'Adresse introuvable. Répétez l’adresse ou choisissez le point sur la carte.',
    currentLocationUnavailable: 'Impossible de déterminer votre position. Autorisez la géolocalisation ou indiquez une adresse.',
    unsupported: 'La saisie vocale n’est pas prise en charge par ce navigateur. Utilisez le formulaire à l’écran.',
    noSpeech: 'Aucune parole reconnue. Appuyez sur le bouton et réessayez.',
    failed: 'Erreur de saisie vocale. Réessayez ou utilisez le formulaire.',
    switchToText: 'Saisir par texte', switchToVoice: 'Revenir à la voix', send: 'Envoyer',
  },
  ar: {
    start: 'اطلب بالصوت',
    stop: 'إيقاف',
    ready: 'الطلب الصوتي جاهز',
    submitting: 'جارٍ إرسال طلبك.',
    pickup: 'اذكر مكان الانطلاق أو قل «من هنا».',
    destination: 'إلى أين تريد الذهاب؟ اذكر الوجهة.',
    confirmation: 'تحقق من نقطتي الانطلاق والوصول على الخريطة. إذا كان كل شيء صحيحاً، قل «أؤكد».',
    success: 'تم إرسال الطلب. تفاصيل الرحلة ظاهرة على الشاشة.',
    validation: 'لم يتم إرسال الطلب. تحقق من الحقول المطلوبة والمنطقة على الشاشة، ثم قل «أؤكد».',
    cancelled: 'تم إيقاف الطلب الصوتي. لم يتم إنشاء أي طلب.',
    addressNotFound: 'لم يتم العثور على العنوان. أعد ذكره أو اختر النقطة على الخريطة.',
    currentLocationUnavailable: 'تعذر تحديد موقعك. اسمح بالوصول إلى الموقع أو اذكر العنوان.',
    unsupported: 'الإدخال الصوتي غير مدعوم في هذا المتصفح. استخدم نموذج الطلب على الشاشة.',
    noSpeech: 'لم يتم التعرف على الكلام. اضغط الزر وحاول مرة أخرى.',
    failed: 'حدث خطأ في الإدخال الصوتي. حاول مرة أخرى أو استخدم الشاشة.',
    switchToText: 'اكتب النص', switchToVoice: 'العودة إلى الصوت', send: 'إرسال',
  },
  en: {
    start: 'Order by voice',
    stop: 'Stop',
    ready: 'Voice ordering is ready',
    submitting: 'Submitting your order.',
    pickup: 'Say the pickup address, or say “from here”.',
    destination: 'Where would you like to go?',
    confirmation: 'Check the pickup and destination on the map. If correct, say “confirm”.',
    success: 'Your order was submitted. Trip details are shown on the screen.',
    validation: 'The order was not submitted. Check required fields and service coverage on screen, then say “confirm”.',
    cancelled: 'Voice ordering stopped. No order was created.',
    addressNotFound: 'Address not found. Repeat it or select a point on the map.',
    currentLocationUnavailable: 'Could not determine your location. Allow location access or say an address.',
    unsupported: 'Voice input is not supported in this browser. Use the on-screen order form.',
    noSpeech: 'No speech was recognized. Press the button and try again.',
    failed: 'Voice input failed. Try again or use the screen.',
    switchToText: 'Use text input', switchToVoice: 'Return to voice', send: 'Send',
  },
  es: {
    start: 'Pedir por voz',
    stop: 'Detener',
    ready: 'El pedido por voz está listo',
    submitting: 'Enviando tu pedido.',
    pickup: 'Di la dirección de recogida o di «aquí».',
    destination: '¿A dónde quieres ir?',
    confirmation: 'Comprueba los puntos en el mapa. Si todo está correcto, di «confirmar».',
    success: 'El pedido se ha enviado. Los detalles aparecen en la pantalla.',
    validation: 'No se ha enviado el pedido. Comprueba los campos obligatorios y la zona en la pantalla y vuelve a confirmar.',
    cancelled: 'Se ha detenido el pedido por voz. No se ha creado ningún pedido.',
    addressNotFound: 'No se encontró la dirección. Repítela o selecciona el punto en el mapa.',
    currentLocationUnavailable: 'No se pudo determinar tu ubicación. Permite el acceso a la ubicación o di una dirección.',
    unsupported: 'Este navegador no admite entrada de voz. Utiliza el formulario en pantalla.',
    noSpeech: 'No se reconoció la voz. Pulsa el botón e inténtalo de nuevo.',
    failed: 'Error de entrada de voz. Inténtalo de nuevo o utiliza la pantalla.',
    switchToText: 'Escribir texto', switchToVoice: 'Volver a la voz', send: 'Enviar',
  },
}

function languageKey(languageIso?: string): string {
  const key = String(languageIso || 'ru').toLowerCase().split(/[-_]/)[0]
  return VOICE_COPY[key] ? key : 'ru'
}

function speechLanguage(languageIso?: string): string {
  const key = languageKey(languageIso)
  return ({
    ru: 'ru-RU',
    fr: 'fr-FR',
    ar: 'ar-MA',
    en: 'en-US',
    es: 'es-ES',
  } as Record<string, string>)[key]
}

function includesAny(value: string, phrases: string[]): boolean {
  const normalized = ` ${value.replace(/[.,!?;:]/g, ' ').replace(/\s+/g, ' ').trim()} `
  return phrases.some(phrase => normalized.includes(` ${phrase} `))
}

function isCurrentLocationPhrase(text: string): boolean {
  const value = text.toLocaleLowerCase().trim()
  return includesAny(value, [
    'отсюда', 'здесь', 'тут', 'с моего местоположения', 'с текущего местоположения',
    'ici', 'depuis ma position', 'à ma position actuelle',
    'here', 'from here', 'my current location',
    'aquí', 'desde aquí', 'mi ubicación actual',
    'من هنا', 'هنا', 'موقعي الحالي',
  ])
}

function isConfirmation(text: string): boolean {
  const value = text.toLocaleLowerCase().trim()
  return includesAny(value, [
    'да', 'подтверждаю', 'заказать', 'верно', 'давай',
    'oui', 'confirmer', 'yes', 'confirm', 'order', 'sí', 'confirmar',
    'نعم', 'أؤكد', 'اطلب',
  ])
}

function isRejection(text: string): boolean {
  const value = text.toLocaleLowerCase().trim()
  return includesAny(value, [
    'нет', 'не надо', 'отмена', 'отбой',
    'non', 'annuler', 'no', 'cancel',
    'لا', 'إلغاء',
  ])
}

const getCurrentLocationPoint = (): Promise<IAddressPoint> => new Promise((resolve, reject) => {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    reject(new Error('GEOLOCATION_UNSUPPORTED'))
    return
  }

  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const latitude = Number(coords.latitude)
      const longitude = Number(coords.longitude)
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        reject(new Error('GEOLOCATION_INVALID_POSITION'))
        return
      }

      // Coordinates are supplied before the dialogue proceeds. The existing
      // client-order saga will reverse-geocode this point for the form.
      resolve({ latitude, longitude })
    },
    error => reject(error),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
  )
})

const normalizePoint = async (
  query: string,
  searchCenter: [number, number] | null,
): Promise<IAddressPoint> => {
  const address = await passengerGateway.geocode(query, {
    details: true,
    searchCenter: searchCenter || undefined,
  })
  const latitude = Number(address?.lat)
  const longitude = Number(address?.lon)
  const displayName = String(address?.display_name || '').trim()
  if (!displayName || !Number.isFinite(latitude) || !Number.isFinite(longitude))
    throw new Error('ADDRESS_NOT_FOUND')

  return {
    address: displayName,
    shortAddress: displayName,
    latitude,
    longitude,
  }
}

export const PassengerVoiceAssistant: React.FC<IProps> = ({
  languageIso,
  getMapSearchCenter,
  setFrom,
  setTo,
  onSubmitOrder,
}) => {
  const copy = VOICE_COPY[languageKey(languageIso)]
  const [active, setActive] = useState(false)
  const [message, setMessage] = useState(copy.ready)
  const [transcript, setTranscript] = useState('')
  const [textMode, setTextMode] = useState(false)
  const textModeRef = useRef(false)
  const [textInput, setTextInput] = useState('')
  const channelRef = useRef<BrowserVoiceChannel | null>(null)
  const activeRef = useRef(false)
  const stepRef = useRef<VoiceStep>('idle')
  const propsRef = useRef({ languageIso, getMapSearchCenter, setFrom, setTo, onSubmitOrder })
  propsRef.current = { languageIso, getMapSearchCenter, setFrom, setTo, onSubmitOrder }
  const transcriptHandlerRef = useRef<(text: string) => Promise<void>>(async() => undefined)
  const listenLoopRef = useRef<() => Promise<void>>(async() => undefined)

  const speak = async(text: string) => {
    setMessage(text)
    if (!textMode)
      await channelRef.current?.speak(text, speechLanguage(propsRef.current.languageIso))
  }

  transcriptHandlerRef.current = async(text: string) => {
    if (!activeRef.current)
      return

    setTranscript(text)
    const currentStep = stepRef.current
    const currentCopy = VOICE_COPY[languageKey(propsRef.current.languageIso)]

    if (currentStep === 'pickup' || currentStep === 'destination') {
      try {
        const isCurrentLocation = isCurrentLocationPhrase(text)
        const point = isCurrentLocation ?
          await getCurrentLocationPoint() :
          await normalizePoint(text, propsRef.current.getMapSearchCenter())
        if (currentStep === 'pickup')
          propsRef.current.setFrom(point)
        else
          propsRef.current.setTo(point)

        const nextStep: VoiceStep = currentStep === 'pickup' ? 'destination' : 'confirmation'
        stepRef.current = nextStep
        await speak(nextStep === 'destination' ? currentCopy.destination : currentCopy.confirmation)
      } catch (error) {
        const currentCopy = VOICE_COPY[languageKey(propsRef.current.languageIso)]
        await speak(
          isCurrentLocationPhrase(text) ?
            currentCopy.currentLocationUnavailable :
            currentCopy.addressNotFound,
        )
      }
      return
    }

    if (currentStep === 'confirmation') {
      if (isRejection(text)) {
        activeRef.current = false
        stepRef.current = 'idle'
        setActive(false)
        await speak(currentCopy.cancelled)
        return
      }

      if (!isConfirmation(text)) {
        await speak(currentCopy.confirmation)
        return
      }

      stepRef.current = 'submitting'
      await speak(currentCopy.submitting)
      const submitted = await propsRef.current.onSubmitOrder()
      if (submitted) {
        activeRef.current = false
        stepRef.current = 'idle'
        setActive(false)
        await speak(currentCopy.success)
      } else {
        stepRef.current = 'confirmation'
        await speak(currentCopy.validation)
      }
    }
  }

  listenLoopRef.current = async() => {
    const channel = channelRef.current
    if (!channel)
      return

    while (activeRef.current && !textModeRef.current) {
      try {
        await channel.listenOnce(speechLanguage(propsRef.current.languageIso))
      } catch (error) {
        if (!activeRef.current || textModeRef.current || (error instanceof Error && error.message === 'VOICE_STOPPED'))
          break
        if (error instanceof Error && ['NO_SPEECH_RESULT', 'no-speech'].includes(error.message)) {
          // Silence is not a dialogue timeout. Keep the current step and listen again.
          await new Promise(resolve => window.setTimeout(resolve, 500))
          continue
        }
        activeRef.current = false
        setActive(false)
        const currentCopy = VOICE_COPY[languageKey(propsRef.current.languageIso)]
        setMessage(currentCopy.failed)
        break
      }
    }
  }

  useEffect(() => {
    const runtime = platformInterface.runtime
    const channel = new BrowserVoiceChannel(runtime)
    channelRef.current = channel
    const unregister = runtime.registerHandler(async action => {
      if (action.type !== VOICE_TRANSCRIPT_RECEIVED)
        return
      const payload = action.payload as { text?: unknown }
      const text = String(payload?.text || '').trim()
      if (text)
        await transcriptHandlerRef.current(text)
    })

    return () => {
      activeRef.current = false
      unregister()
      channel.stop()
      channelRef.current = null
    }
  }, [])

  const start = async() => {
    const channel = channelRef.current
    const currentCopy = VOICE_COPY[languageKey(languageIso)]
    if (!channel || !channel.isRecognitionSupported()) {
      setMessage(currentCopy.unsupported)
      return
    }

    const isNewDialogue = stepRef.current === 'idle'
    activeRef.current = true
    textModeRef.current = false
    setTextMode(false)
    setActive(true)
    if (isNewDialogue) {
      stepRef.current = 'pickup'
      setTranscript('')
      await speak(currentCopy.pickup)
    }
    if (activeRef.current)
      void listenLoopRef.current()
  }

  const switchToText = () => {
    textModeRef.current = true
    setTextMode(true)
    channelRef.current?.stopRecognition()
    setMessage(VOICE_COPY[languageKey(languageIso)][stepRef.current === 'pickup' ? 'pickup' : stepRef.current === 'destination' ? 'destination' : 'confirmation'])
  }

  const switchToVoice = () => {
    const channel = channelRef.current
    if (!channel || !channel.isRecognitionSupported()) {
      setMessage(VOICE_COPY[languageKey(languageIso)].unsupported)
      return
    }
    textModeRef.current = false
    setTextMode(false)
    if (!activeRef.current)
      activeRef.current = true
    setActive(true)
    void listenLoopRef.current()
  }

  const submitText = async(event: React.FormEvent) => {
    event.preventDefault()
    const value = textInput.trim()
    if (!value || !activeRef.current)
      return
    setTextInput('')
    await transcriptHandlerRef.current(value)
  }

  const stop = () => {
    activeRef.current = false
    stepRef.current = 'idle'
    textModeRef.current = false
    setTextMode(false)
    channelRef.current?.stop()
    setActive(false)
    setMessage(VOICE_COPY[languageKey(languageIso)].cancelled)
  }

  return (
    <section className={`passenger-voice${active ? ' passenger-voice--active' : ''}`} data-testid="passenger-voice">
      <button
        type="button"
        className="passenger-voice__toggle"
        onClick={active ? stop : start}
        aria-pressed={active}
        aria-label={active ? copy.stop : copy.start}
      >
        {<VoiceIcon muted={active} />}
        <span>{active ? copy.stop : copy.start}</span>
      </button>
      {active && (
        <div className="passenger-voice__mode">
          {textMode ? (
            <button type="button" onClick={switchToVoice}>{copy.switchToVoice}</button>
          ) : (
            <button type="button" onClick={switchToText}>{copy.switchToText}</button>
          )}
        </div>
      )}
      {active && textMode && (
        <form className="passenger-voice__text-form" onSubmit={submitText}>
          <input
            aria-label={copy.switchToText}
            value={textInput}
            onChange={event => setTextInput(event.target.value)}
            autoComplete="off"
          />
          <button type="submit" disabled={!textInput.trim()}>{copy.send}</button>
        </form>
      )}
      {(active || transcript || message !== copy.ready) && (
        <div className="passenger-voice__panel" role="status" aria-live="polite">
          <p className="passenger-voice__message">{message}</p>
          {transcript && <p className="passenger-voice__transcript">{transcript}</p>}
        </div>
      )}
    </section>
  )
}

export default PassengerVoiceAssistant
