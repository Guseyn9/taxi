import React, { useEffect, useState } from 'react'
import { Eye, EyeOff,Mail,MessageCircle } from 'lucide-react'
import { configSelectors } from '../../../state/config'
import { dialogCopy } from '../dialogCopy'
import { authCopy } from './authCopy'
import Config from '../../../config'
import { t, TRANSLATION } from '../../../localization'
import Checkbox from '../../Checkbox'
import { useForm, useWatch } from 'react-hook-form'
import Button from '../../Button'
import { connect, ConnectedProps } from 'react-redux'
import images from '../../../constants/images'
import { IRootState } from '../../../state'
import { EStatuses, EUserRoles } from '../../../types/types'
import { userActionCreators, userSelectors } from '../../../state/user'
import { ERegistrationType, LOGIN_TABS_IDS } from '../../../state/user/constants'
import { emailRegex, phoneRegex } from '../../../tools/utils'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'
import Alert from '../../Alert/Alert'
import { Intent } from '../../Alert'
import { useVisibility } from '../../../tools/hooks'
import { GoogleLoginButton } from 'react-social-login-buttons'
import { useLocation } from 'react-router-dom'
import { modalsActionCreators,  modalsSelectors } from '../../../state/modals'
import { Input } from './elements'
import { beginGoogleOAuth, googleOAuthAvailable } from '../../../security/authCallback'
import { usePlatformNavigator } from '../../../platform/platform-interface'


const mapStateToProps = (state: IRootState) => ({
  language: configSelectors.language(state),
  user: userSelectors.user(state),
  status: userSelectors.status(state),
  tab: userSelectors.tab(state),
  message: userSelectors.message(state),
  isWAOpen: modalsSelectors.isWACodeModalOpen,
})

const mapDispatchToProps = {
  login: userActionCreators.login,
  setLoginModal: modalsActionCreators.setLoginModal,
  googleLogin: userActionCreators.googleLogin,
  logout: userActionCreators.logout,
  remindPassword: userActionCreators.remindPassword,
  setStatus: userActionCreators.setStatus,
  setMessage: userActionCreators.setMessage,
  register: userActionCreators.register,
  setWAOpen: modalsActionCreators.setWACodeModal,
  setRefOpen: modalsActionCreators.setRefCodeModal,
}

const connector = connect(mapStateToProps, mapDispatchToProps)

interface IFormValues {
    login: string | undefined,
    password?: string | undefined,
    type: ERegistrationType
}

interface IProps extends ConnectedProps<typeof connector> {
    isOpen: boolean,
}


export const LoginForm: React.FC<IProps> = ({
  language,
  user,
  status,
  tab,
  googleLogin,
  isOpen,
  setWAOpen,
  setRefOpen,
  login,
  logout,
  remindPassword,
  setMessage,
  setStatus,
  setLoginModal,
  message,
}) => {
  const copy = dialogCopy(language?.iso)
  const auth = authCopy(language?.iso)
  const [isPasswordShows, setIsPasswordShows] = useState(false)
  const [dataToLogin, setDataToLogin] = useState({})
  const [isVisible, toggleVisibility] = useVisibility(false)
  const [isPasswordVisible, togglePasswordVisibility] = useVisibility(true)
  const location = useLocation()
  const { navigatePath: navigate } = usePlatformNavigator()
  const googleClientId = '973943716904-b33r11ijgi08m5etsg5ndv409shh1tjl.apps.googleusercontent.com'

  const role = !location.pathname.includes('/driver-order') ?
    EUserRoles.Client :
    EUserRoles.Driver

  const schema = yup.object({
    type: yup.string().required(t(TRANSLATION.REQUIRED_FIELD)),
    password: yup.string().required(t(TRANSLATION.REQUIRED_FIELD)),
    login: yup.string().required(t(TRANSLATION.REQUIRED_FIELD)).when('type', {
      is: (type: ERegistrationType) => (type === ERegistrationType.Email),
      then: yup.string().required(t(TRANSLATION.REQUIRED_FIELD)).matches(emailRegex, t(TRANSLATION.EMAIL_ERROR)),
      otherwise: yup.string().required(t(TRANSLATION.REQUIRED_FIELD)).matches(phoneRegex, t(TRANSLATION.PHONE_PATTERN_ERROR)),
    }),
  })


  const {
    register: formRegister,
    handleSubmit,
    formState: { errors, isDirty },
    control,
    trigger,
  } = useForm<IFormValues>({
    criteriaMode: 'all',
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: {
      login: user?.u_email || '',
      type: ERegistrationType.Email,
    },
    resolver: yupResolver(user ? yup.object() : schema),
  })
  const { login: formLogin, type } = useWatch<IFormValues>({ control })

  useEffect(() => {
    if (!isOpen) {
      setStatus(EStatuses.Default)
      setMessage('')
    }
    if (isOpen && isVisible) {
      toggleVisibility()
    }
  }, [isOpen])

  useEffect(() => {
    isDirty && trigger()
  }, [type])

  useEffect(() => {
    if (type === ERegistrationType.Whatsapp && isPasswordVisible) {
      togglePasswordVisibility()
    } else if (!isPasswordVisible) {
      togglePasswordVisibility()
    }
  }, [type])


  useEffect(() => {
    if (
      (status === EStatuses.Fail || status === EStatuses.Success && user) &&
      type !== ERegistrationType.Whatsapp && !isVisible
    ) {
      console.log('togglin, prev: ', isVisible)
      toggleVisibility()
    } else if (status === EStatuses.Whatsapp) {
      setLoginModal(false)
      setWAOpen({
        isOpen: true,
        login: login,
        data: { ...dataToLogin, navigate },
      })
    }
  }, [status])
  useEffect(() => {
    if(status === EStatuses.Success && message==='remind_password_success') {
      toggleVisibility()
      if (!isVisible) {
        toggleVisibility()
      }
    }
  }, [status])

  if (tab !== LOGIN_TABS_IDS[0]) return null

  const onSubmit = (data: IFormValues) => {
    console.log(status, user)
    if (isVisible) toggleVisibility()
    setDataToLogin(data)
    if (user) {
      logout()
    } else if (data) {
      const loginData: IFormValues = data.type === 'whatsapp' ?
        {
          type: data.type,
          login: data.login || '',
        } :
        {
          ...data,
          login: data.login || '',
        }
      login({ ...loginData, navigate: navigate })
    }
  }

  return (
    <form
      className="login-form sign-in-subform"
      noValidate
      aria-busy={status===EStatuses.Loading}
      onSubmit={handleSubmit(onSubmit)}
    >
      <div className="auth-login-fields">
      <Input
        inputProps={{
          ...formRegister('login'),
          required: true,
          autoComplete: 'username',
          inputMode: type === ERegistrationType.Email ? 'email' : 'tel',
          autoCapitalize: 'none',
          spellCheck: false,
          placeholder: type === ERegistrationType.Phone || type === ERegistrationType.Whatsapp ?
            t(TRANSLATION.PHONE) :
            t(TRANSLATION.EMAIL),
        }}
        label={t(TRANSLATION.LOGIN)}
        error={errors.login?.message}
        key={type}
      />
      {isPasswordVisible &&
            <Input
              inputProps={{
                ...formRegister('password'),
                required: true,
                autoComplete: 'current-password',
                autoCapitalize: 'none',
                spellCheck: false,
                type: isPasswordShows ? 'text' : 'password',
                placeholder: t(TRANSLATION.PASSWORD),
              }}
              label={t(TRANSLATION.PASSWORD)}
              error={errors.password?.message}
              buttons={[
                {
                  type: 'button',
                  checkLogin: false,
                  className: 'auth-password-toggle',
                  wrapperProps: { className: 'auth-password-toggle-control' },
                  svg: isPasswordShows ? <EyeOff aria-hidden="true" size={20} /> : <Eye aria-hidden="true" size={20} />,
                  title: isPasswordShows ? copy.hidePassword : copy.showPassword,
                  'aria-label': isPasswordShows ? copy.hidePassword : copy.showPassword,
                  'aria-pressed': isPasswordShows,
                  onClick: () => setIsPasswordShows(prev => !prev),
                },
              ].filter(item => Object.values(item).length)}
            />
      }

      {!user && <div className="auth-recovery-row"><button type="button" className="auth-recovery-link"
        disabled={!formLogin || !!errors.login || status === EStatuses.Loading}
        onClick={() => { formLogin && window.confirm(t(TRANSLATION.PASSWORD_RESET_MESSAGE)) && remindPassword(formLogin) }}>
        {t(TRANSLATION.RESTORE_PASSWORD)}
      </button></div>}
      <fieldset className="auth-channel-options"><legend className="sr-only">{t('login_method')}</legend><div className="auth-channel-choice"><Mail size={18} aria-hidden="true"/><Checkbox
        {...formRegister('type')}
        type="radio"
        label={t(TRANSLATION.EMAIL)}
        value={ERegistrationType.Email}
        id="email"
      />
      </div><div className="auth-channel-choice auth-channel-choice--unavailable" title={auth.unavailable}><MessageCircle size={18} aria-hidden="true"/><Checkbox
        {...formRegister('type')}
        type="radio"
        label={`WhatsApp · ${auth.unavailable}`}
        disabled
        value={ERegistrationType.Whatsapp}
        id="whatsapp"
      />
      </div></fieldset>

      {
        isVisible &&
            <div className="alert-container">
              <Alert
                intent={status === EStatuses.Fail ? Intent.ERROR : Intent.SUCCESS}
                message={(status === EStatuses.Fail ? t(TRANSLATION.LOGIN_FAIL) + ': ' + message : ( message === 'remind_password_success' ? t(TRANSLATION.REMIND_PASSWORD_SUCCESS) : t(TRANSLATION.LOGIN_SUCCESS)))}
                onClose={toggleVisibility}
              />
            </div>
      }

      {Number(role) !== EUserRoles.Driver && Boolean(googleClientId) && googleOAuthAvailable() && (
        <a className="auth-google" onClick={event => { event.preventDefault(); window.location.assign(beginGoogleOAuth(event.currentTarget.href)) }} href={`https://accounts.google.com/o/oauth2/v2/auth?response_type=code&access_type=offline&client_id=${googleClientId}&redirect_uri=${Config.SERVER_URL}/google/&scope=email%20profile&prompt=select_account`}>
          <GoogleLoginButton text={t('google_sign_in')} style={{margin:0,width:'100%',height:48,boxShadow:'none',background:'#fff',border:'1px solid #e6e3eb',borderRadius:12,fontSize:14}} activeStyle={{background:'#f8f7fa'}}/>
        </a>

      )}
      </div>
      <Button
        type="submit"
        text={!!user ? t(TRANSLATION.LOGOUT) : t(TRANSLATION.SIGN_IN)}
        fixedSize={false}
        className="login-modal_login-btn"
        wrapperProps={{className:'auth-login-footer'}}
        skipHandler={true}
        disabled={status===EStatuses.Loading}
        status={status}
      />
    </form>
  )
}

export default connector(LoginForm)
