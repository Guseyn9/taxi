import cn from 'classnames'
import React, { useEffect, useRef, useId } from 'react'
import { X } from 'lucide-react'
import { t, TRANSLATION } from '../../localization'
import { createPortal } from 'react-dom'
import './styles.scss'
import { Helmet } from 'react-helmet-async'
import SITE_CONSTANTS from '../../siteConstants'
import { activateDialog, dialogTabStops, topDialog, restoreDialogFocus } from './dialogFocus'

interface IProps {
  isOpen: boolean,
  onClick?: () => any,
  children: React.ReactNode,
  wrapperClassName?: string,
  overlayClassName?: string,
}

const Overlay: React.FC<IProps> = ({
  isOpen,
  onClick,
  children,
  wrapperClassName,
  overlayClassName,
}) => {
  const titleId = useId()
  const wrapperRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!isOpen) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const releaseLayer = activateDialog(wrapper)
    const updateTitle = () => {
      const heading = wrapper.querySelector<HTMLElement>('legend,h1,h2,h3,[role="heading"]')
      if (heading) {
        if (!heading.id) heading.id = titleId
        wrapper.setAttribute('aria-labelledby', heading.id)
      } else wrapper.removeAttribute('aria-labelledby')
    }
    updateTitle()
    const observer = new MutationObserver(updateTitle)
    observer.observe(wrapper, { childList: true, subtree: true, characterData: true })
    const frame = requestAnimationFrame(() => {
      if (topDialog() === wrapper && !wrapper.contains(document.activeElement)) wrapper.focus({ preventScroll: true })
    })
    return () => { observer.disconnect(); cancelAnimationFrame(frame); releaseLayer(); restoreDialogFocus(previous) }
  }, [isOpen])

  const content = (
    <div
      ref={wrapperRef}
      role={isOpen ? 'dialog' : undefined}
      aria-modal={isOpen || undefined}
      aria-hidden={!isOpen}
      aria-label="Taxi"
      tabIndex={-1}
      onKeyDown={event => {
        if (!isOpen || topDialog() !== wrapperRef.current || !wrapperRef.current?.contains(document.activeElement)) return
        if (event.key === 'Escape' && onClick) { event.preventDefault(); event.stopPropagation(); onClick(); return }
        if (event.key !== 'Tab') return
        const nodes = dialogTabStops(wrapperRef.current)
        const first = nodes[0], last = nodes[nodes.length - 1]
        if (!first) { event.preventDefault(); return }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === wrapperRef.current)) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === wrapperRef.current)) { event.preventDefault(); first.focus() }
      }}
      className={cn('overlay__wrapper', wrapperClassName, { 'overlay__wrapper--active': isOpen })}
    >
      <Helmet>
        <style>
          {`
          .modal form fieldset, .login-modal fieldset {
            border: 2px solid ${SITE_CONSTANTS.PALETTE.primary.main};
          }
          .modal form fieldset legend, .login-modal fieldset legend {
            color: ${SITE_CONSTANTS.PALETTE.primary.dark};
          }
          `}
        </style>
      </Helmet>
      <div
        className={cn('overlay', overlayClassName)}
        onClick={onClick}
      />

      {children}
      {isOpen && onClick && <button type="button" className="rs-dialog-close" aria-label={t(TRANSLATION.CLOSE)} onClick={onClick}><X aria-hidden="true" size={20} /></button>}
    </div>
  )

  if (typeof document === 'undefined')
    return content

  return createPortal(content, document.body)
}

export default Overlay
