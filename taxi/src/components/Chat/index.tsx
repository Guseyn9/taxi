import cn from 'classnames'
import React, { useRef } from 'react'
import { useState, useEffect } from 'react'
import { connect, ConnectedProps } from 'react-redux'
import { IRootState } from '../../state'
import { IUser } from '../../types/types'
import { useForm } from 'react-hook-form'
import './styles.scss'
import { t, TRANSLATION } from '../../localization'
import Input, { EInputTypes } from '../Input'
import { Resizable } from 're-resizable'
import { modalsActionCreators, modalsSelectors } from '../../state/modals'
import { SHARED_CHAT_SURFACE_ID, useRegisteredSurface } from '../../platform/platform-interface'
import { chatGateway } from '../../platform/adapters/LegacyChatGateway'
import type { LegacyChatSession } from '../../platform/adapters/LegacyChatGateway'

const ResizableComponent = Resizable as React.ComponentType<any>

enum EMessageType {
  MainUserMessage,
  AnotherUserMessage,
  Action
}

interface IMessage {
  text: string,
  from?: string,
  type?: EMessageType
}

interface ISocketData {
  action: string,
  event?: string,
  arg?: string,
  msg?: string,
  history?: {
    action?: string,
    to: string,
    from: string,
    msg: string,
  }[],
  from?: string
}

interface IFormValues {
  message: string,
}

const getMessageClass = (type?: EMessageType) => {
  switch(type) {
    case EMessageType.MainUserMessage: return 'main-user-message'
    case EMessageType.AnotherUserMessage: return 'another-user-message'
    case EMessageType.Action: return 'action'
    default: return 'main-user-message'
  }
}

const mapStateToProps = (state: IRootState) => ({
  activeChat: modalsSelectors.activeChat(state),
})

const mapDispatchToProps = {
  setActiveChat: modalsActionCreators.setActiveChat,
}

const connector = connect(mapStateToProps, mapDispatchToProps)

interface IProps extends ConnectedProps<typeof connector> {
}

const Chat: React.FC<IProps> = ({
  activeChat,
  setActiveChat,
}) => {
  useRegisteredSurface(SHARED_CHAT_SURFACE_ID, Boolean(activeChat))
  const [messages, setMessages] = useState<IMessage[]>([])
  const [anotherUser, setAnotherUser] = useState<IUser | null>(null)
  const sessionRef = useRef<LegacyChatSession | null>(null)
  const messagesRef = useRef<HTMLDivElement>(null)

  const {
    register,
    getValues,
    handleSubmit: formHandleSubmit,
    reset,
  } = useForm<IFormValues>({
    criteriaMode: 'all',
    mode: 'onSubmit',
  })

  const [from = '', to = ''] = activeChat?.split(';') ?? []
  const [anotherUserID = '', order = ''] = to.split('_')

  useEffect(() => {
    if (!activeChat || !from || !to || !anotherUserID)
      return undefined

    setMessages([])
    setAnotherUser(null)
    chatGateway.getUser(anotherUserID)
      .then(setAnotherUser)
      .catch(error => console.error(error))

    const session = chatGateway.connect({
      from,
      to,
      onMessage: rawData => {
        let data: ISocketData
        try {
          data = JSON.parse(String(rawData)) as ISocketData
        } catch (error) {
          console.error('Wrong chat message:', error)
          return
        }
        const { action, event, arg, msg, from: dataFrom, history } = data

        switch (action) {
          case 'notify': {
            const message = {
              type: EMessageType.Action,
              from: arg || from,
            } as IMessage
            switch (event) {
              case 'joined':
                message.text = 'joined the conversation'
                break
              case 'left':
                message.text = 'left the conversation'
                break
              case 'you-joined':
                message.text = 'joined the conversation'
                break
              case 'you-left':
                message.text = 'left the conversation'
                break
              default: console.error('Wrong chat event:', event)
            }

            setMessages(prev => [...prev, message])

            // TODO
            // '<i><font color="#044">' + text + '</font></i>'
            break
          }
          case 'send': {
            // TODO
            // const color =  ? '#f00' : '#00f'

            const message = {
              type: from === dataFrom ? EMessageType.MainUserMessage : EMessageType.AnotherUserMessage,
              from: dataFrom,
              text: msg as string,
            }

            setMessages(prev => [...prev, message])
            break
          }
          case 'history': {
            history && setMessages(
              history.map((item) => ({
                type: from === item.from ? EMessageType.MainUserMessage : EMessageType.AnotherUserMessage,
                from: item.from,
                text: item.msg,
              })),
            )
            break
          }
          default: console.error('Wrong chat event:', event)
        }
      },
      onError: error => {
        console.error('Socket error:', error)
      },
    })
    sessionRef.current = session

    return () => {
      session.close()
      if (sessionRef.current === session)
        sessionRef.current = null
    }
  }, [activeChat, anotherUserID, from, to])

  if (!activeChat) return null

  const handleSubmit = () => {
    const sent = sessionRef.current?.send(getValues().message) ?? false
    if (!sent)
      return console.error('Error: Socket is not ready yet for send')

    reset()
  }

  return (
    <ResizableComponent
      defaultSize={{ height: 400, width: 300 }}
      className="chat"
      handleStyles={{
        top: {
          top: 0,
          height: 50,
        },
      }}
    >
      <form
        onSubmit={formHandleSubmit(handleSubmit)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="chat__header">
          №{order} {anotherUser?.u_name}
          <button type="button" className="chat__close-button" onClick={(e) => {e.stopPropagation(); setActiveChat(null)}}>✖</button>
        </div>

        <div className="chat__messages" ref={messagesRef}>
          {
            messages.map((item, index) =>
              <div key={`${item.from || 'action'}-${index}`} className={cn('chat__message', `chat__message--${getMessageClass(item.type)}`)}>
                {item.from && <span className="chat__name">{item.from === from ? 'You' : anotherUser?.u_name}</span>}
                {item.text}
              </div>,
            )
          }
        </div>

        <div className="chat__footer">
          <Input
            inputProps={{
              ...register('message', { required: t(TRANSLATION.REQUIRED_FIELD) }),
              placeholder:'Enter message text',
              autoFocus:true,
            }}
            fieldWrapperClassName="chat__input"
            inputType={EInputTypes.Textarea}
            buttons={[{
              className:'chat__send-button',
              type: 'submit',
              text: '✉',
            }]}
          />
        </div>
      </form>
    </ResizableComponent>
  )
}

export default connector(Chat)
