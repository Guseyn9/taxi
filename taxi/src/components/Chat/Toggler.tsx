import React from 'react'
import { MessageCircle } from 'lucide-react'
import { connect, ConnectedProps } from 'react-redux'
import { IRootState } from '../../state'
import { IOrder, IUser } from '../../types/types'
import './styles.scss'
import Button from '../Button'
import { modalsActionCreators, modalsSelectors } from '../../state/modals'
import { userSelectors } from '../../state/user'
import { t, TRANSLATION } from '../../localization'

const mapStateToProps = (state: IRootState) => ({
  user: userSelectors.user(state),
  activeChat: modalsSelectors.activeChat(state),
})

const mapDispatchToProps = {
  setActiveChat: modalsActionCreators.setActiveChat,
}

const connector = connect(mapStateToProps, mapDispatchToProps)

interface IProps extends ConnectedProps<typeof connector> {
  anotherUserID: IUser['u_id']
  orderID: IOrder['b_id']
  small?: boolean
  text?: string
  onClick?: (e: React.MouseEvent) => void
}

const Toggler: React.FC<IProps> = ({
  activeChat,
  user,
  anotherUserID,
  orderID,
  small,
  text,
  setActiveChat,
  onClick,
}) => {
  const from = `${user?.u_id}_${orderID}`
  const to = `${anotherUserID}_${orderID}`
  const chatID = `${from};${to}`

  const handleClick: React.MouseEventHandler = (e) => {
    e.stopPropagation()
    if (onClick) {
      onClick(e)
    } else {
      setActiveChat(activeChat === chatID ? null : chatID)
    }
  }

  return (
    small ?
      <button type="button" className="chat__toggler chat__toggler--small" aria-label={t(TRANSLATION.CHAT)} aria-expanded={activeChat === chatID} onClick={handleClick}><MessageCircle aria-hidden="true" size={20} /></button> :
      <Button text={text} className="chat__toggler" aria-label={t(TRANSLATION.CHAT)} aria-expanded={activeChat === chatID} onClick={handleClick} svg={<MessageCircle aria-hidden="true" size={20} />}/>
  )
}

export default connector(Toggler)