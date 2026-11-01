import {
  DialogueStateManager,
  VoiceChannel as DialogueVoiceChannel,
} from 'voice-assistant/platform-runtime'
import type {
  ActionDispatcher,
  DialogueContext,
  DispatchResult,
  ScenarioSet,
  SessionIdentity,
} from 'voice-assistant/platform-runtime'
import {
  BrowserRecognitionProvider,
  BrowserSpeechProvider,
} from 'voice-assistant/voice/browser'
import {
  DefaultRecognitionMapper,
  VoiceChannel as TransportVoiceChannel,
} from 'voice-assistant/voice/channel'
import type { IAddressPoint } from '../../types/types'
import type { PlatformApplicationContract } from '../platform-interface/PlatformInterfaceRuntime'
import { passengerGateway } from '../adapters/LegacyPassengerGateway'

export interface PassengerVoiceCopy {
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
}

export interface PassengerVoicePlatformOptions {
  ownerId: string
  language: 'ru' | 'fr' | 'ar' | 'en' | 'es'
  speechLanguage: string
  copy: PassengerVoiceCopy
  interaction: PlatformApplicationContract
  getMapSearchCenter: () => [number, number] | null
  setFrom: (point: IAddressPoint) => unknown
  setTo: (point: IAddressPoint) => unknown
  onSubmitOrder: () => Promise<boolean>
  onMessage: (message: string) => void
  onTranscript: (text: string) => void
  onSubmitting: (submitting: boolean) => void
  onActiveChange: (active: boolean) => void
}

type AddressSlot = 'pickup' | 'destination'

const PICKUP_PATTERNS: Record<PassengerVoicePlatformOptions['language'], string> = {
  ru: '^(?:отсюда|здесь|тут|с\\s+.+|из\\s+.+|от\\s+.+)$',
  fr: '^(?:ici|d\\s?ici|depuis\\s+.+|de\\s+.+)$',
  ar: '^(?:هنا|من\\s+هنا|من\\s+.+)$',
  en: '^(?:here|from\\s+here|from\\s+.+)$',
  es: '^(?:aquí|desde\\s+aquí|desde\\s+.+|de\\s+.+)$',
}

const DESTINATION_PATTERNS: Record<PassengerVoicePlatformOptions['language'], string> = {
  ru: '^(?:в\\s+.+|до\\s+.+|на\\s+.+|к\\s+.+)$',
  fr: '^(?:à\\s+.+|vers\\s+.+|pour\\s+.+)$',
  ar: '^(?:إلى\\s+.+|الى\\s+.+|ل\\s+.+)$',
  en: '^(?:to\\s+.+|for\\s+.+)$',
  es: '^(?:a\\s+.+|hacia\\s+.+|para\\s+.+)$',
}

const CONFIRMATIONS: Record<PassengerVoicePlatformOptions['language'], { yes: string[]; no: string[] }> = {
  ru: {
    yes: ['да', 'подтверждаю', 'верно', 'заказать', 'поехали'],
    no: ['нет', 'не надо', 'отмена заказа', 'отбой'],
  },
  fr: {
    yes: ['oui', 'confirmer', 'je confirme', 'd’accord', 'valider'],
    no: ['non', 'annuler', 'pas maintenant'],
  },
  ar: {
    yes: ['نعم', 'أؤكد', 'موافق', 'أكد'],
    no: ['لا', 'إلغاء', 'ألغ'],
  },
  en: {
    yes: ['yes', 'confirm', 'confirmed', 'order'],
    no: ['no', 'cancel', 'do not'],
  },
  es: {
    yes: ['sí', 'si', 'confirmar', 'confirmo', 'vale'],
    no: ['no', 'cancelar', 'anular'],
  },
}

function createPassengerOrderScenario(options: PassengerVoicePlatformOptions): ScenarioSet {
  const confirmation = CONFIRMATIONS[options.language]
  return {
    version: 1,
    id: `taxi-passenger-order-${options.language}`,
    name: 'Taxi passenger address order',
    scenarios: [{
      id: `taxi-passenger-create-order-${options.language}`,
      name: 'Create passenger taxi order',
      activation: { type: 'voice', value: 'voice.taxi-order' },
      intent: 'CREATE_PASSENGER_TAXI_ORDER',
      priority: 100,
      requiredSlots: ['pickup', 'destination', 'confirmation'],
      slotExtractors: {
        pickup: {
          type: 'string',
          pattern: PICKUP_PATTERNS[options.language],
          priority: 100,
        },
        destination: {
          type: 'string',
          pattern: DESTINATION_PATTERNS[options.language],
          priority: 100,
        },
        confirmation: {
          type: 'enum',
          mapping: {
            CONFIRMED: confirmation.yes,
            REJECTED: confirmation.no,
          },
          priority: 200,
        },
      },
      clarificationPrompts: {
        pickup: options.copy.pickup,
        destination: options.copy.destination,
        confirmation: options.copy.confirmation,
      },
      ambiguityPrompt: {
        template: options.copy.failed,
      },
      confirmation: {
        slot: 'confirmation',
        confirmedValue: 'CONFIRMED',
        confirmedStatus: 'CONFIRMED',
        rejectedValue: 'REJECTED',
        confirmedMessage: options.copy.success,
        cancelledMessage: options.copy.cancelled,
      },
      steps: [{
        kind: 'emit',
        event: {
          type: 'passenger.order.created',
          payload: {
            pickup: '{{slots.pickup}}',
            destination: '{{slots.destination}}',
          },
        },
      }],
    }],
  }
}

function normalizeText(value: string): string {
  return value.toLocaleLowerCase().trim().replace(/[.!?؟،,;:]+$/gu, '').replace(/\\s+/g, ' ')
}

function isCurrentLocationPhrase(value: string): boolean {
  const text = normalizeText(value)
  const phrases: Record<PassengerVoicePlatformOptions['language'], string[]> = {
    ru: ['отсюда', 'здесь', 'тут', 'с текущего местоположения'],
    fr: ['ici', 'd’ici', 'depuis ma position'],
    ar: ['هنا', 'من هنا', 'موقعي الحالي'],
    en: ['here', 'from here', 'my current location'],
    es: ['aquí', 'desde aquí', 'mi ubicación actual'],
  }
  return phrases[Object.keys(phrases).find(key => key === key) as PassengerVoicePlatformOptions['language']].some(
    phrase => text === normalizeText(phrase),
  )
}

function stripAddressPrefix(value: string, language: PassengerVoicePlatformOptions['language']): string {
  const prefixes: Record<PassengerVoicePlatformOptions['language'], RegExp> = {
    ru: /^(?:с|из|от|в|до|на|к)\\s+/iu,
    fr: /^(?:depuis|de|du|des|à|au|aux|vers|pour)\\s+/iu,
    ar: /^(?:من|إلى|الى|ل)\\s*/u,
    en: /^(?:from|to|at|in|for)\\s+/iu,
    es: /^(?:desde|de|a|hacia|para)\\s+/iu,
  }
  return value.trim().replace(prefixes[language], '').trim()
}

function getCurrentLocationPoint(): Promise<IAddressPoint> {
  return new Promise((resolve, reject) => {
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
        resolve({ latitude, longitude })
      },
      error => reject(error),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    )
  })
}

async function geocodeAddress(
  query: string,
  searchCenter: [number, number] | null,
): Promise<IAddressPoint> {
  const address = await passengerGateway.geocode(query, {
    details: true,
    searchCenter: searchCenter || undefined,
  })
  const latitude = Number(address?.lat)
  const longitude = Number(address?.lon)
  const displayName = String(address?.display_name || '').trim()
  if (!displayName || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('ADDRESS_NOT_FOUND')
  }
  return {
    address: displayName,
    shortAddress: displayName,
    latitude,
    longitude,
  }
}

function getResultContext(
  result: any,
  manager: DialogueStateManager,
  identity: SessionIdentity,
): DialogueContext | undefined {
  const contextId = typeof result?.contextId === 'string'
    ? result.contextId
    : typeof result?.context?.contextId === 'string'
      ? result.context.contextId
      : undefined
  if (contextId) {
    return manager.getContext(contextId, identity)
  }
  return manager.getActiveState(identity)
}

export class PassengerVoicePlatform {
  private readonly options: PassengerVoicePlatformOptions
  private readonly identity: SessionIdentity
  private readonly manager: DialogueStateManager
  private readonly dialogue: DialogueVoiceChannel
  private readonly recognition: BrowserRecognitionProvider
  private readonly speech: BrowserSpeechProvider
  private readonly transport: TransportVoiceChannel
  private unregisterAction: (() => void) | null = null
  private active = false
  private textMode = false
  private recognitionError: string | null = null
  private readonly addressValues: Record<AddressSlot, string | null> = {
    pickup: null,
    destination: null,
  }
  private readonly resolvedPoints: Record<AddressSlot, IAddressPoint | null> = {
    pickup: null,
    destination: null,
  }
  private readonly addressPromises: Record<AddressSlot, Promise<IAddressPoint> | null> = {
    pickup: null,
    destination: null,
  }
  private readonly addressRequestIds: Record<AddressSlot, number> = {
    pickup: 0,
    destination: 0,
  }

  constructor(options: PassengerVoicePlatformOptions) {
    this.options = options
    this.identity = {
      ownerId: options.ownerId,
      sessionId: `passenger-web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
    }

    const actionDispatcher: ActionDispatcher = async(event, _context, execution): Promise<DispatchResult> => {
      if (event.type !== 'passenger.order.created') {
        return {
          status: 'FAILED',
          executionId: execution.executionId,
          errorCode: 'UNSUPPORTED_PASSENGER_EVENT',
          attempt: execution.attempt,
        }
      }

      this.options.onSubmitting(true)
      try {
        await Promise.all(
          (Object.values(this.addressPromises).filter(Boolean) as Promise<IAddressPoint>[]),
        )
        if (!this.resolvedPoints.pickup || !this.resolvedPoints.destination) {
          return {
            status: 'FAILED',
            executionId: execution.executionId,
            errorCode: 'PASSENGER_ADDRESS_NOT_RESOLVED',
            attempt: execution.attempt,
          }
        }

        // Address updates have already been committed to the ordinary form state
        // during slot filling; the dispatcher only invokes the existing submit path.
        const submitted = await this.options.onSubmitOrder()
        return submitted
          ? { status: 'SUCCEEDED', executionId: execution.executionId, attempt: execution.attempt }
          : {
              status: 'FAILED',
              executionId: execution.executionId,
              errorCode: 'ORDER_FORM_VALIDATION_FAILED',
              attempt: execution.attempt,
            }
      } catch (error) {
        return {
          status: 'FAILED',
          executionId: execution.executionId,
          errorCode: error instanceof Error ? error.message : 'PASSENGER_ORDER_DISPATCH_FAILED',
          attempt: execution.attempt,
        }
      } finally {
        this.options.onSubmitting(false)
      }
    }

    this.manager = new DialogueStateManager({
      maxActiveContexts: 1,
      defaultTtlMs: 300000,
      actionDispatcher,
    })
    this.dialogue = new DialogueVoiceChannel(this.manager)
    this.dialogue.registerScenarioSet(createPassengerOrderScenario(options))

    this.recognition = new BrowserRecognitionProvider(options.speechLanguage)
    this.speech = new BrowserSpeechProvider()
    this.speech.setLanguage(options.speechLanguage)
    this.transport = new TransportVoiceChannel({
      recognition: this.recognition,
      speech: this.speech,
      interaction: options.interaction,
      recognitionMapper: new DefaultRecognitionMapper(),
      speechMapper: {
        map: (event: any) => ({
          text: typeof event?.payload?.text === 'string' ? event.payload.text : '',
          language: options.speechLanguage,
        }),
      },
    })

    this.transport.ensureInteractionSubscribed()
    this.transport.onAction = action => {
      const payload = action.payload as { text?: unknown } | undefined
      const transcript = String(payload?.text || '').trim()
      if (transcript) this.options.onTranscript(transcript)
    }
    this.transport.onSpeak = text => this.options.onMessage(text)

    this.speech.onFinished = () => {
      if (this.active && !this.textMode) {
        void this.transport.start()
      }
    }
    this.speech.onError = (_text, message) => {
      this.options.onMessage(message === 'not-allowed' ? options.copy.unsupported : options.copy.failed)
      if (this.active && !this.textMode) {
        void this.transport.start()
      }
    }
    this.recognition.onError = message => {
      this.recognitionError = message
      if (message === 'no-speech') {
        this.options.onMessage(options.copy.noSpeech)
      } else if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(message)) {
        this.options.onMessage(options.copy.unsupported)
      } else {
        this.options.onMessage(options.copy.failed)
      }
    }
    this.recognition.onEnded = hadResult => {
      if (hadResult || !this.active || this.textMode) return
      const error = this.recognitionError
      this.recognitionError = null
      if (error && ['not-allowed', 'service-not-allowed', 'audio-capture'].includes(error)) {
        this.active = false
        this.options.onActiveChange(false)
        void this.transport.stop()
        return
      }
      void this.restartListening()
    }

    this.unregisterAction = options.interaction.registerHandler(async action => {
      if (action.type !== 'voice.recognized') return
      const payload = action.payload as { text?: unknown } | undefined
      const transcript = String(payload?.text || '').trim()
      if (!transcript || !this.active) return
      await this.transport.stop()
      await this.handleText(transcript, true)
    })
  }

  isRecognitionSupported(): boolean {
    return this.recognition.isSupported
  }

  async start(): Promise<void> {
    if (!this.recognition.isSupported) {
      this.options.onMessage(this.options.copy.unsupported)
      return
    }
    if (this.active) return
    this.active = true
    this.textMode = false
    this.options.onActiveChange(true)
    const result = await this.dialogue.handleIncomingVoice('voice.taxi-order', this.identity)
    await this.syncAddressSlots(getResultContext(result, this.manager, this.identity))
    const message = this.getResponseMessage(result)
    this.options.onMessage(message)
    this.speakResponse(message)
  }

  async stop(): Promise<void> {
    this.active = false
    this.textMode = false
    this.options.onActiveChange(false)
    await this.speech.stop()
    await this.transport.stop()
    const context = this.manager.getActiveState(this.identity)
    if (context?.status === 'WAITING_FOR_SLOT' || context?.status === 'DISPATCHING') {
      await this.manager.cancelContext(context.contextId, this.identity)
    }
  }

  async switchToText(): Promise<void> {
    this.textMode = true
    await this.speech.stop()
    await this.transport.stop()
    const context = this.manager.getActiveState(this.identity)
    this.options.onMessage(context?.clarificationPrompt || this.options.copy.pickup)
  }

  async switchToVoice(): Promise<void> {
    if (!this.active || !this.recognition.isSupported) return
    this.textMode = false
    const context = this.manager.getActiveState(this.identity)
    const message = context?.clarificationPrompt || this.options.copy.pickup
    this.options.onMessage(message)
    this.speakResponse(message)
  }

  async submitText(text: string): Promise<void> {
    const value = text.trim()
    if (!value || !this.active || !this.textMode) return
    await this.handleText(value, false)
  }

  async dispose(): Promise<void> {
    await this.stop()
    this.unregisterAction?.()
    this.unregisterAction = null
  }

  private async handleText(text: string, fromVoice: boolean): Promise<void> {
    if (!this.active) return
    this.options.onTranscript(text)
    try {
      const result = await this.dialogue.handleIncomingVoice(text, this.identity)
      const context = getResultContext(result, this.manager, this.identity)
      const addressError = await this.syncAddressSlots(context)

      if (result?.status === 'SELECTION_REJECTED') {
        if (context) await this.manager.cancelContext(context.contextId, this.identity)
        this.active = false
        this.options.onActiveChange(false)
        this.options.onMessage(this.options.copy.cancelled)
        if (fromVoice) this.speakResponse(this.options.copy.cancelled)
        return
      }

      if (result?.status === 'COMPLETED') {
        this.active = false
        this.options.onActiveChange(false)
        this.options.onMessage(this.options.copy.success)
        if (fromVoice) this.speakResponse(this.options.copy.success)
        return
      }

      const message = addressError
        ? `${this.options.copy.addressNotFound} ${addressError === 'pickup' ? this.options.copy.pickup : this.options.copy.destination}`
        : this.getResponseMessage(result)
      this.options.onMessage(message)
      if (fromVoice) this.speakResponse(message)
    } catch {
      this.options.onMessage(this.options.copy.failed)
      if (fromVoice) this.speakResponse(this.options.copy.failed)
    }
  }

  private getResponseMessage(result: any): string {
    if (result?.status === 'FAILED') return this.options.copy.validation
    if (typeof result?.message === 'string' && result.message) return result.message
    if (typeof result?.clarificationPrompt === 'string' && result.clarificationPrompt) return result.clarificationPrompt
    const context = getResultContext(result, this.manager, this.identity)
    return context?.clarificationPrompt || this.options.copy.pickup
  }

  private speakResponse(text: string): void {
    if (!this.active || this.textMode) return
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      void this.transport.start()
      return
    }
    this.options.interaction.publish({
      type: 'voice.response',
      payload: { text },
    })
  }

  private async restartListening(): Promise<void> {
    if (!this.active || this.textMode) return
    await this.transport.stop()
    await new Promise(resolve => window.setTimeout(resolve, 500))
    if (this.active && !this.textMode) {
      await this.transport.start()
    }
  }

  private async syncAddressSlots(context?: DialogueContext): Promise<AddressSlot | null> {
    if (!context) return null
    let firstError: AddressSlot | null = null
    const values: Array<[AddressSlot, unknown]> = [
      ['pickup', context.slots.pickup],
      ['destination', context.slots.destination],
    ]

    for (const [slot, raw] of values) {
      if (typeof raw !== 'string' || !raw.trim()) continue
      if (this.addressValues[slot] === raw && this.resolvedPoints[slot]) continue

      this.addressValues[slot] = raw
      this.resolvedPoints[slot] = null
      const requestId = ++this.addressRequestIds[slot]
      const promise = this.resolvePoint(raw)
      this.addressPromises[slot] = promise
      try {
        const point = await promise
        if (requestId !== this.addressRequestIds[slot] || this.addressValues[slot] !== raw) continue
        this.resolvedPoints[slot] = point
        if (slot === 'pickup') this.options.setFrom(point)
        else this.options.setTo(point)
      } catch {
        if (requestId === this.addressRequestIds[slot]) {
          this.addressValues[slot] = null
          this.resolvedPoints[slot] = null
          firstError = firstError || slot
        }
      }
    }
    return firstError
  }

  private async resolvePoint(raw: string): Promise<IAddressPoint> {
    if (isCurrentLocationPhrase(raw)) {
      return getCurrentLocationPoint()
    }
    const query = stripAddressPrefix(raw, this.options.language)
    if (!query) throw new Error('ADDRESS_NOT_FOUND')
    return geocodeAddress(query, this.options.getMapSearchCenter())
  }
}
