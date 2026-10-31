import { BrowserVoiceChannel, VOICE_TRANSCRIPT_RECEIVED } from '../BrowserVoiceChannel'

class MockSpeechRecognition {
  static instance: MockSpeechRecognition
  lang = ''
  interimResults = false
  maxAlternatives = 1
  continuous = false
  onresult: ((event: any) => void) | null = null
  onerror: ((event: any) => void) | null = null
  onend: (() => void) | null = null
  autoResult: string | null = 'Отсюда'

  constructor() {
    MockSpeechRecognition.instance = this
  }

  start() {
    if (this.autoResult) {
      this.onresult?.({
        resultIndex: 0,
        results: [[{ transcript: this.autoResult, confidence: 0.97 }]],
      })
    }
    this.onend?.()
  }

  stop() {}
}

describe('BrowserVoiceChannel', () => {
  const originalSpeechRecognition = (window as any).SpeechRecognition

  afterEach(() => {
    if (originalSpeechRecognition === undefined)
      delete (window as any).SpeechRecognition
    else
      (window as any).SpeechRecognition = originalSpeechRecognition
    jest.clearAllMocks()
  })

  it('dispatches recognized speech through PlatformInterfaceRuntime', async() => {
    ;(window as any).SpeechRecognition = MockSpeechRecognition
    const runtime = { dispatch: jest.fn().mockResolvedValue(undefined) }
    const channel = new BrowserVoiceChannel(runtime as any)

    await channel.listenOnce('ru-RU')

    expect(runtime.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: VOICE_TRANSCRIPT_RECEIVED,
      payload: expect.objectContaining({
        text: 'Отсюда',
        language: 'ru-RU',
      }),
      metadata: expect.objectContaining({ source: 'passenger.voice.web' }),
    }))
  })

  it('reports an empty recognition result instead of silently looping', async() => {
    ;(window as any).SpeechRecognition = MockSpeechRecognition
    MockSpeechRecognition.prototype.autoResult = null
    const channel = new BrowserVoiceChannel({ dispatch: jest.fn() } as any)

    await expect(channel.listenOnce('ru-RU')).rejects.toThrow('NO_SPEECH_RESULT')
  })

  it('settles the pending listen operation when the user stops', async() => {
    class WaitingRecognition extends MockSpeechRecognition {
      start() {}
    }
    ;(window as any).SpeechRecognition = WaitingRecognition
    const channel = new BrowserVoiceChannel({ dispatch: jest.fn() } as any)
    const pending = channel.listenOnce('ru-RU')

    channel.stop()

    await expect(pending).rejects.toThrow('VOICE_STOPPED')
  })
})
