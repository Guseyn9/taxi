import type { InteractionAction } from '../interaction-contract'
import type { PlatformInterfaceRuntime } from '../platform-interface'

export const VOICE_TRANSCRIPT_RECEIVED = 'voice.transcript.received'

interface RecognitionAlternativeLike {
  transcript?: string
  confidence?: number
}

interface RecognitionEventLike {
  resultIndex: number
  results: ArrayLike<ArrayLike<RecognitionAlternativeLike>>
}

interface RecognitionErrorLike {
  error?: string
  message?: string
}

interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  continuous: boolean
  onresult: ((event: RecognitionEventLike) => void) | null
  onerror: ((event: RecognitionErrorLike) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

type SpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike
  webkitSpeechRecognition?: new () => SpeechRecognitionLike
}

/**
 * Browser transport for the Voice modality.
 *
 * It only converts microphone input into an Interaction Action. It has no
 * taxi/order semantics; the Passenger application owns dialogue and actions.
 */
export class BrowserVoiceChannel {
  private recognition: SpeechRecognitionLike | null = null
  private cancelSpeech: (()=>void)|null=null
  private cancelPending: (() => void) | null = null

  constructor(private readonly runtime: PlatformInterfaceRuntime) {}

  isRecognitionSupported(): boolean {
    const speechWindow = window as SpeechWindow
    return Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition)
  }

  async listenOnce(language: string): Promise<void> {
    const speechWindow = window as SpeechWindow
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition
    if (!Recognition)
      throw new Error('SPEECH_RECOGNITION_UNSUPPORTED')

    this.stopRecognition()

    await new Promise<void>((resolve, reject) => {
      const recognition = new Recognition()
      this.recognition = recognition
      recognition.lang = language
      recognition.interimResults = false
      recognition.maxAlternatives = 1
      recognition.continuous = false

      let settled = false
      let hasResult = false
      let dispatchPending = false
      let ended = false
      let cancelCurrent: (() => void) | null = null

      const cleanup = () => {
        if (cancelCurrent && this.cancelPending === cancelCurrent)
          this.cancelPending = null
        if (this.recognition === recognition)
          this.recognition = null
        recognition.onresult = null
        recognition.onerror = null
        recognition.onend = null
      }
      const succeed = () => {
        if (settled || dispatchPending)
          return
        settled = true
        cleanup()
        resolve()
      }
      const fail = (error: Error) => {
        if (settled)
          return
        settled = true
        cleanup()
        reject(error)
      }
      cancelCurrent = () => fail(new Error('VOICE_STOPPED'))
      this.cancelPending = cancelCurrent

      recognition.onresult = event => {
        if(hasResult || settled)return
        const result = event.results?.[event.resultIndex]?.[0]
        const text = String(result?.transcript || '').trim()
        if (!text)
          return

        hasResult = true
        dispatchPending = true
        const action: InteractionAction = {
          type: VOICE_TRANSCRIPT_RECEIVED,
          payload: {
            text,
            confidence: result?.confidence,
            language,
          },
          metadata: {
            source: 'passenger.voice.web',
            timestamp: new Date().toISOString(),
            correlationId: `voice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          },
        }

        try{recognition.stop()}catch{}
        void this.runtime.dispatch(action).then(() => {
          dispatchPending = false
          if (ended || hasResult)
            succeed()
        }, error => fail(error instanceof Error ? error : new Error(String(error))))
      }

      recognition.onerror = event => {
        fail(new Error(event.error || event.message || 'SPEECH_RECOGNITION_FAILED'))
      }

      recognition.onend = () => {
        ended = true
        if (!hasResult)
          fail(new Error('NO_SPEECH_RESULT'))
        else
          succeed()
      }

      try {
        recognition.start()
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  async speak(text: string, language: string): Promise<void> {
    if (!text || typeof window === 'undefined' || !('speechSynthesis' in window))
      return

    this.cancelSpeech?.()
    window.speechSynthesis.cancel()
    await new Promise<void>(resolve => {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = language
      const finish=()=>{if(this.cancelSpeech===finish)this.cancelSpeech=null;resolve()}
      this.cancelSpeech=finish
      utterance.onend = finish
      utterance.onerror = finish
      window.speechSynthesis.speak(utterance)
    })
  }

  stopRecognition(): void {
    const recognition = this.recognition
    this.cancelPending?.()
    this.cancelPending = null
    this.recognition = null
    if (recognition) {
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      try {
        recognition.stop()
      } catch {
        // A recognition session may already have ended.
      }
    }
  }

  stop(): void {
    this.stopRecognition()
    this.cancelSpeech?.()
    if (typeof window !== 'undefined' && 'speechSynthesis' in window)
      window.speechSynthesis.cancel()
  }
}
