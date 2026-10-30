import React from 'react'
import {Menu,X} from 'lucide-react'
import './styles.scss'

interface IBurgerProps extends React.HTMLAttributes<HTMLButtonElement> {
    isOpen: boolean
}

export function Burger({ isOpen, onClick, ...props }: IBurgerProps) {
  return (
    <button
      {...props}
      type="button"
      aria-label={props['aria-label'] || 'Menu'}
      aria-expanded={isOpen}
      className='burger-button'
      onClick={onClick}
    >
      {isOpen ? <X size={24} strokeWidth={2} aria-hidden="true"/> : <Menu size={24} strokeWidth={2} aria-hidden="true"/>}
    </button>
  )
}
