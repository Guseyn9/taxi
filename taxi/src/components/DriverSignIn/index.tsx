import React from 'react'
import { LogIn } from 'lucide-react'
import ErrorFrame from '../ErrorFrame'
import { t, TRANSLATION } from '../../localization'

export default function DriverSignIn({ onSignIn }: { onSignIn: () => void }) {
  return (
    <ErrorFrame
      title={t(TRANSLATION.UNAUTHORIZED_ACCESS)}
      renderImage={() => (
        <button type="button" className="errorIcon driver-login-action" onClick={onSignIn}>
          <LogIn size={20} aria-hidden="true" /><span>{t(TRANSLATION.SIGN_IN_HEADER)}</span>
        </button>
      )}
    />
  )
}
