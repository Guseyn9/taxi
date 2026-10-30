import React from 'react'
import './styles.scss'

export default function Theme({ children }: React.PropsWithChildren) {
  return (
    <div
      className="theme"
      style={{
        '--theme--primary-main': 'var(--drive-red,#b51218)',
        '--theme--primary-light': 'color-mix(in srgb,var(--drive-red,#b51218),white 50%)',
        '--theme--primary-dark': 'color-mix(in srgb,var(--drive-red,#b51218),black 35%)',
        '--theme--secondary-main': 'var(--drive-orange,#e87516)',
        '--theme--secondary-light': 'color-mix(in srgb,var(--drive-orange,#e87516),white 50%)',
        '--theme--secondary-dark': 'color-mix(in srgb,var(--drive-orange,#e87516),black 35%)',
      } as React.CSSProperties}
    >
      {children}
    </div>
  )
}