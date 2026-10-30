import React from 'react'
import { sanitizeHtml } from '../../security/html'

interface IProps {
  html?: string
  inline?: boolean
}

function HTML({ html = '', inline = false }: IProps) {
  const content = {__html:sanitizeHtml(html,inline)}
  return inline ? <span dangerouslySetInnerHTML={content}/> :
    <div style={{display:'contents'}} dangerouslySetInnerHTML={content}/>
}

export default HTML
