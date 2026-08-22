import type { IUser } from '../../types/types'
import {
  ReconnectingWebSocketClient,
} from '../platform-interface/realtime'
import type { Unsubscribe } from '../interaction-contract'
import { backendGateway } from './LegacyBackendGateway'

const LEGACY_CHAT_URL = 'wss://chat.itest24.com:7007'

export interface LegacyChatSession {
  send(message: string): boolean
  close(): void
}

export interface LegacyChatConnection {
  readonly from: string
  readonly to: string
  readonly onMessage: (data: unknown) => void
  readonly onError?: (error: unknown) => void
}

/** Compatibility adapter. Chat UI does not depend on WebSocket or legacy API. */
export class LegacyChatGateway {
  getUser(userId: string): Promise<IUser | null> {
    return backendGateway.getUser(userId)
  }

  connect(connection: LegacyChatConnection): LegacyChatSession {
    const client = new ReconnectingWebSocketClient()
    const stop: Unsubscribe = client.connect(LEGACY_CHAT_URL, {
      onOpen: () => {
        client.send(JSON.stringify({
          from: connection.from,
          to: connection.to,
          action: 'start',
        }))
      },
      onMessage: connection.onMessage,
      onError: connection.onError,
    })

    return {
      send: message => client.send(JSON.stringify({
        from: connection.from,
        to: connection.to,
        msg: message,
        action: 'send',
      })),
      close: stop,
    }
  }
}

export const chatGateway = new LegacyChatGateway()
