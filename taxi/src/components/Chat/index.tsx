import {readChatDraft,saveChatDraft} from './drafts'
import {subscribeResume} from '../../design/reliability/readHealth'
import cn from 'classnames'
import { ChatSendTracker, ChatSendState } from './sendTracker'
import { chatStatusCopy } from './statusCopy'
import React, { useRef, useId } from 'react'
import { Send, X } from 'lucide-react'
import { configSelectors } from '../../state/config'
import { dialogCopy } from '../modals/dialogCopy'
import { restoreDialogFocus } from '../modals/dialogFocus'
import Overlay from '../modals/Overlay'
import { isRideRtl } from '../../design/copy'
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
  language: configSelectors.language(state),
})

const mapDispatchToProps = {
  setActiveChat: modalsActionCreators.setActiveChat,
}

const connector = connect(mapStateToProps, mapDispatchToProps)

interface IProps extends ConnectedProps<typeof connector> {
}

export const Chat: React.FC<IProps> = ({
  language,
  activeChat,
  setActiveChat,
}) => {
  useRegisteredSurface(SHARED_CHAT_SURFACE_ID, Boolean(activeChat))
  const [messages, setMessages] = useState<IMessage[]>([])
  const [anotherUser, setAnotherUser] = useState<IUser | null>(null)
  const [connectionRevision,setConnectionRevision]=useState(0)
  const sessionRef = useRef<LegacyChatSession | null>(null)
  const sendTrackerRef = useRef<ChatSendTracker | null>(null)
  const [sendState, setSendState] = useState<ChatSendState>({ connection: 'connecting', delivery: 'idle', text: '' })
  const messagesRef = useRef<HTMLDivElement>(null)
  const followMessages = useRef(true)
  const titleId = useId()
  const copy = dialogCopy(language?.iso)
  const statusCopy = chatStatusCopy(language?.iso)
  useEffect(() => {
    if (!activeChat) return
    followMessages.current = true
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = requestAnimationFrame(() => messagesRef.current?.closest('.chat')?.querySelector('textarea')?.focus())
    return () => { cancelAnimationFrame(frame); restoreDialogFocus(previous) }
  }, [activeChat])
  useEffect(() => {
    const list = messagesRef.current
    if (list && followMessages.current) list.scrollTop = list.scrollHeight
  }, [messages])

  const {
    register,
    watch,
    getValues,
    handleSubmit: formHandleSubmit,
    reset,
    setValue,
  } = useForm<IFormValues>({
    criteriaMode: 'all',
    mode: 'onSubmit',
  })

  const [from = '', to = ''] = activeChat?.split(';') ?? []
  const [anotherUserID = '', order = ''] = to.split('_')

  useEffect(()=>{if(!activeChat)return;const persist=()=>{const tracker=sendTrackerRef.current?.state;saveChatDraft(activeChat,{draft:getValues().message||'',unconfirmed:tracker&&['pending','unconfirmed','failed'].includes(tracker.delivery)?tracker.text:''})};const subscription=watch(persist);return()=>{persist();subscription.unsubscribe()}},[activeChat,watch,getValues])
  useEffect(()=>subscribeResume(()=>{if(activeChat&&sendTrackerRef.current?.state.connection!=='ready')setConnectionRevision(value=>value+1)}),[activeChat])

  useEffect(() => {
    if (!activeChat || !from || !to || !anotherUserID)
      return undefined

    setMessages([])
    setAnotherUser(null)
    let disposed=false
    const saved=readChatDraft(activeChat)
    setValue('message',saved.draft)
    const tracker = new ChatSendTracker(from, state=>{setSendState(state);saveChatDraft(activeChat,{draft:getValues().message||'',unconfirmed:['pending','unconfirmed','failed'].includes(state.delivery)?state.text:''})},saved.unconfirmed)
    sendTrackerRef.current = tracker
    setSendState(tracker.state)
    chatGateway.getUser(anotherUserID)
      .then(user=>{if(!disposed)setAnotherUser(user)})
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
        if (action === 'history' || (action === 'notify' && event === 'you-joined')) tracker.connected()
        if (action === 'send') tracker.echo(dataFrom, msg)

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
      onState: state=>{if(state==='closed')tracker.connectionError();else if(state==='connecting')tracker.connecting()},
      onError: error => {
        tracker.connectionError()
        console.error('Socket error:', error)
      },
    })
    sessionRef.current = session

    return () => {
      disposed=true
      saveChatDraft(activeChat,{draft:getValues().message||'',unconfirmed:['pending','unconfirmed','failed'].includes(tracker.state.delivery)?tracker.state.text:''})
      tracker.dispose()
      if (sendTrackerRef.current === tracker) sendTrackerRef.current = null
      session.close()
      if (sessionRef.current === session)
        sessionRef.current = null
    }
  }, [activeChat, anotherUserID, from, to, connectionRevision, getValues, setValue])

  if (!activeChat) return null

  const handleSubmit = () => {
    sendTrackerRef.current?.submit(
      getValues().message,
      text => sessionRef.current?.send(text) ?? false,
      () => reset(),
    )
  }

  const hasSavedText = ['unconfirmed', 'failed'].includes(sendState.delivery) && Boolean(sendState.text)

  return (
    <Overlay isOpen={Boolean(activeChat)} onClick={() => setActiveChat(null)} wrapperClassName="chat-overlay">
    <ResizableComponent
      defaultSize={{ height: 400, width: 300 }}
      className="chat"
      dir={isRideRtl(language?.iso) ? 'rtl' : undefined}
      handleStyles={{
        top: {
          top: 0,
          height: 8,
        },
      }}
    >
      <form
        onSubmit={formHandleSubmit(handleSubmit)}
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setActiveChat(null) }
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="chat__header">
          <div className="chat__heading"><span id={titleId} role="heading" aria-level={2}>{copy.chat}</span><span className="chat__conversation">№{order}{anotherUser?.u_name ? ` · ${anotherUser.u_name}` : ''}</span></div>
          <button type="button" aria-label={t(TRANSLATION.CLOSE)} className="chat__close-button" onClick={(e) => {e.stopPropagation(); setActiveChat(null)}}><X aria-hidden="true" size={20} /></button>
        </div>

        <div className="chat__connection-status" role="status" aria-live="polite" data-state={sendState.connection}>
          <span>{statusCopy[sendState.connection]}</span>
          {sendState.connection==='error'&&<button type="button" onClick={()=>setConnectionRevision(value=>value+1)}>{statusCopy.retry}</button>}
        </div>
        <div className="chat__messages" ref={messagesRef} role="log" aria-live="polite" aria-relevant="additions text" onScroll={event => {
          const list = event.currentTarget
          followMessages.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48
        }}>
          {
            messages.map((item, index) =>
              <div key={`${item.from || 'action'}-${index}`} className={cn('chat__message', `chat__message--${getMessageClass(item.type)}`)}>
                {item.from && <span className="chat__name">{item.from === from ? copy.you : anotherUser?.u_name}</span>}
                {item.text}
              </div>,
            )
          }
        </div>

        <div className="chat__footer">
          {sendState.delivery !== 'idle' && <div className="chat__send-status" role="status" aria-live="polite" data-state={sendState.delivery}>
            {statusCopy[sendState.delivery]}
          </div>}
          {hasSavedText && <div className="chat__retained-message">
            <textarea readOnly value={sendState.text} aria-label={statusCopy.retained} rows={2} />
            <button type="button" onClick={() => {
              const draft = getValues().message
              setValue('message', draft === sendState.text ? draft : [draft, sendState.text].filter(Boolean).join('\n'), { shouldDirty: true })
              messagesRef.current?.closest('.chat')?.querySelector<HTMLTextAreaElement>('.chat__input textarea')?.focus()
            }}>{statusCopy.restore}</button>
          </div>}
          <Input
            inputProps={{
              ...register('message', { required: t(TRANSLATION.REQUIRED_FIELD) }),
              'aria-label': t(TRANSLATION.MESSAGE),
              placeholder:copy.message,
            }}
            fieldWrapperClassName="chat__input"
            inputType={EInputTypes.Textarea}
            buttons={[{
              className:'chat__send-button',
              'aria-label': copy.send,
              type: 'submit',
              disabled: sendState.delivery === 'pending' || sendState.connection !== 'ready',
              svg: <Send aria-hidden="true" size={20} />,
            }]}
          />
        </div>
      </form>
    </ResizableComponent>
    </Overlay>
  )
}

export default connector(Chat)
