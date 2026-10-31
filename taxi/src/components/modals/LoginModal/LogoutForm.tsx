import React from 'react'
import { connect, ConnectedProps } from 'react-redux'
import { IRootState } from '../../../state'
import { usePlatformNavigator } from '../../../platform/platform-interface'
import {
  userSelectors,
  userActionCreators,
} from '../../../state/user'
import { t, TRANSLATION } from '../../../localization'
import { EStatuses, EUserRoles } from '../../../types/types'
import { EInputTypes } from '../../Input'
import Button from '../../Button'
import { Input } from './elements'
import './styles.scss'

const mapStateToProps = (state: IRootState) => ({
  user: userSelectors.user(state),
  status: userSelectors.status(state),
  message: userSelectors.message(state),
})

const mapDispatchToProps = {
  logout: userActionCreators.logout,
  switchDemoRole: userActionCreators.switchDemoRole,
}

const connector = connect(mapStateToProps, mapDispatchToProps)

interface IProps extends ConnectedProps<typeof connector> {}

function LogoutForm({
  user,
  status,
  message,
  logout,
  switchDemoRole,
}: IProps) {
  const { navigatePath: navigate } = usePlatformNavigator()
  const isDemo = Boolean(localStorage.getItem('demo.client_key'))
  const currentRole = user?.u_role === EUserRoles.Driver ? 'driver' : 'client'
  const nextRole = currentRole === 'driver' ? 'client' : 'driver'

  return user && (
    <form
      className="login-form sign-in-subform"
      onSubmit={event => {
        event.preventDefault()
      }}
    >
      <Input
        inputProps={{
          disabled: true,
          value: user.u_phone ?? user.u_email,
        }}
        inputType={user.u_phone ? EInputTypes.MaskedPhone : EInputTypes.Default}
        label={t(TRANSLATION.LOGIN)}
      />

      {isDemo ? (
        <>
          <div className="login-modal__demo-label">{t(TRANSLATION.DEMO_MODE)}</div>
          {status === EStatuses.Fail && message && (
            <div className="error">{message}</div>
          )}
          <Button
            type="button"
            text={t(nextRole === 'driver' ?
              TRANSLATION.DEMO_SWITCH_TO_DRIVER :
              TRANSLATION.DEMO_SWITCH_TO_CLIENT)}
            fixedSize={false}
            className="login-modal_login-btn"
            skipHandler={true}
            disabled={status === EStatuses.Loading}
            onClick={() => switchDemoRole({
              role: nextRole,
              navigate,
            })}
          />
        </>
      ) : (
        <Button
          type="submit"
          text={t(TRANSLATION.LOGOUT)}
          fixedSize={false}
          className="login-modal_login-btn"
          skipHandler={true}
          onClick={() => {
            logout()
          }}
        />
      )}
    </form>
  )
}

export default connector(LogoutForm)