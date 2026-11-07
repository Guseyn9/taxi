import React, { useCallback, useState, useEffect, useRef, useId } from 'react'
import { validateUploadBatch } from '../../security/fileUpload'
import FilePreview from '../FilePreview'
import {Eye,EyeOff} from 'lucide-react'
import {dialogCopy} from '../modals/dialogCopy'
import {PhoneCountryField} from '../modals/LoginModal/PhoneCountryField'
import cn from 'classnames'
import { ILanguage } from '../../types/types'
import { getPhoneMask } from '../../tools/phoneUtils'
import { t } from '../../localization'
import Button from '../Button'
import HTML from '../HTML'
import { TFormElement, TOption, TFormValues } from './types'
import {
  getCalculation, isRequired,
  getTranslation, parseVariable,
} from './utils'
import './styles.scss'

interface IProps {
  element: TFormElement
  validationSchema?: any
  onChange: (e: any, name: string, value: any) => any
  values?: TFormValues
  language?: ILanguage
  variables?: Record<string, any>
  errors?: Record<string, any>
}

function JSONFormElement({
  onChange = () => {},
  values = {},
  validationSchema,
  language,
  variables = {},
  errors = {},
  element: formElement,
}: IProps) {
  const {
    accept,
    placeholder,
    multiple,
    visible,
    disabled,
    options = [],
  } = formElement

  const [ errorMessage, setErrorMessage ] = useState<string>('')
  const [passwordVisible,setPasswordVisible] = useState(false)
  const errorId = useId()
  const [ files, setFiles ] = useState<[any, File][]>()
  const name: string = getCalculation(formElement.name, values, variables)
  const type = getCalculation(formElement.type, values, variables)
  const value = values[name]
  const touched = useRef(false)
  const validationSequence = useRef(0)
  const currentValue = useRef(value)
  currentValue.current = value
  const hintTextName = `hint_${name.split('.').slice(-1)[0]}`
  let hint = formElement.hint
  if (!hint && t(hintTextName,{fallback:''})) {
    hint = getTranslation(hintTextName)
  }

  useEffect(() => {
    if (type === 'file' && value) {
      setFiles(value)
    }
  }, [])

  const validate = useCallback((value: any) => {
    if (!validationSchema) return
    const sequence = ++validationSequence.current
    validationSchema.validate(value)
      .then(() => {
        if (sequence === validationSequence.current && Object.is(value,currentValue.current)) setErrorMessage('')
      })
      .catch((error: any) => {
        if (sequence === validationSequence.current && Object.is(value,currentValue.current)) setErrorMessage(error.message)
      })
  }, [validationSchema])

  if (visible) {
    const isVisible = getCalculation(visible, values, variables)
    if (!isVisible) return null
  }

  type TElement = HTMLInputElement | HTMLSelectElement
  const calculatedDisabled = parseVariable(
    getCalculation(disabled, values, variables),
    variables,
  )
  const commonProperties = {
    name,
    'aria-invalid':Boolean(errorMessage || errors[name]) || undefined,
    'aria-describedby':errorMessage || errors[name] ? errorId : undefined,
    'aria-label': !['radio', 'checkbox'].includes(type) && formElement.label ? String(getTranslation(getCalculation(formElement.label, values, variables))) : undefined,
    disabled: calculatedDisabled,
    onChange(event: React.ChangeEvent<TElement>) {
      const value = getValue(event)
      if (touched.current || errors[name]) validate(value)
      onChange(event, event.target.name, value)
    },
    onBlur(event: React.ChangeEvent<TElement>) {
      touched.current = true
      validate(getValue(event))
    },
  }
  const getValue = (event: React.ChangeEvent<TElement>) => type === 'checkbox' ?
    (event.target as HTMLInputElement).checked : type === 'select' ? event.target.value || null : event.target.value

  let hintElement: any = !hint ?
    null :
    (
      <div className="element__hint">
        <button type="button" className="element__hint_icon" aria-label={getTranslation(hint)}>?</button>
        <div className={`element__hint_message element__hint_message_${!formElement.label ? 'left' : 'right'}`}>
          {getTranslation(hint)}
        </div>
      </div>
    )

  let labelElement: any = !formElement.label ?
    null :
    (
      <div className="element__label">
        {getTranslation(getCalculation(formElement.label, values, variables))}
        {isRequired(formElement, values, variables) && <span className="element__required">*</span>}
        {hintElement}
      </div>
    )
  let element

  if (type === 'hidden') {
    return (
      <input
        type='hidden'
        name={name}
        value={value}
      />
    )
  }

  if (type === 'button' || type === 'submit') {
    const disabledByFormInvalid = getCalculation(disabled, values, variables) === '@form.invalid'

    return (
      <Button
        type={type}
        text={getTranslation(getCalculation(formElement.label, values, variables))}
        disabled={type === 'submit' && disabledByFormInvalid ? false : calculatedDisabled}
        skipHandler
      />
    )
  }

  if (type === 'select') {
    const required = isRequired(formElement, values, variables)
    const selectOptions = getCalculation(options, values, variables)
    element = (
      <select
        {...commonProperties}
        value={value ?? ''}
        className='element__select_input'
      >
        {!required && <option value="">-</option>}
        {selectOptions.map((option: TOption) => (
          <option key={option.value} value={option.value}>
            {!!option.label && getTranslation(option.label)}
            {!!option.labelLang && !!language && option.labelLang[language.iso]}
          </option>
        ))}
      </select>
    )
  }

  if (type === 'radio') {
    const radioOptions = getCalculation(options, values, variables)
    element = (
      <>
        {radioOptions.map((option: TOption) => (
          <label key={option.value} className='element__radio'>
            <input
              {...commonProperties}
              disabled={option.disabled}
              type='radio'
              className='element__radio_input'
              value={option.value}
              checked={values[name] === option.value}
            />
            <span>{getTranslation(option.label)}</span>
          </label>
        ))}
      </>
    )
  }

  if (type === 'checkbox') {
    labelElement = null
    element = (
      <label className='element__checkbox'>
        <input
          {...commonProperties}
          type='checkbox'
          className='element__checkbox_input'
          checked={value}
        />
        <span>
          <HTML inline html={getTranslation(getCalculation(formElement.label, values, variables))}/>
          {isRequired(formElement, values, variables) && <span className="element__required">*</span>}
        </span>
      </label>
    )
  }

  if (type === 'phone') {
    labelElement = null
    element = (
      <PhoneCountryField name={name} value={value || ''} language={language?.iso}
        label={String(getTranslation(getCalculation(formElement.label,values,variables)))}
        required={Boolean(isRequired(formElement,values,variables))} disabled={Boolean(calculatedDisabled)}
        error={errorMessage || errors[name]}
        onChange={next => {if(touched.current || errors[name]) validate(next);onChange(null,name,next)}}
        onBlur={() => {touched.current=true;validate(value)}}/>
    )
  } else if (type === 'file') {
    element = (
      <div className='element__file'>
        {!!files && files.map((file: [any, File], key: number) => (
          <div
            className='element__file_value'
            key={key}
            onClick={e => {
              const newFiles = files.filter((file, index: number) => index !== key)
              setFiles(newFiles)
              const next = newFiles.length ? newFiles : null
              validate(next)
              onChange(e, name, next)
            }}
          >
            <FilePreview file={file[1]}/>
          </div>
        ))}
        <label className={cn('element__file_add', {
          element__file_add_disabled: commonProperties.disabled,
        })}
        >
          <input
            {...commonProperties}
            className='element__file_input'
            type='file'
            multiple={multiple}
            accept={accept}
            onBlur={() => { touched.current = true; validate(currentValue.current) }}
            onChange={e => {
              if (!e.target.files) return
              const inputFiles: [any, File][] = Array.from(e.target.files)
                .map((file: File) => ([ null, file ]))
              const newFiles = (files || []).concat(inputFiles)
              try { validateUploadBatch(newFiles.filter(file => !file[0]).map(file => file[1])) }
              catch (error) { setErrorMessage((error as Error).message); e.target.value = ''; return }
              setErrorMessage('')
              setFiles(newFiles)
              validate(newFiles)
              onChange(e, name, newFiles)
              e.target.value = ''
            }}
          />
        </label>
      </div>
    )
  }

  if (!element) {
    element = (
      <input
        {...commonProperties}
        value={value || ''}
        type={type === 'password' && passwordVisible ? 'text' : type}
        className='element__text_input'
        placeholder={placeholder}
      />
    )
  }

  const Wrap = ['file', 'radio', 'checkbox', 'phone'].includes(type) ? 'div' : 'label'

  const subscription = type === 'file' && accept === 'image/png, image/jpeg, image/jpg' ? t('subscription_images_upload') : null

  return (
    <Wrap className={cn('element__field', {
      'element__field--error': errors[name],
    })}
    >
      {labelElement}
      <div className={type === 'password' ? 'element__password' : type === 'file' || !hintElement ? '' : 'element__input'}>
        {element}
        {type === 'password' && <button type="button" className="auth-json-password-toggle" aria-pressed={passwordVisible}
          aria-label={passwordVisible?dialogCopy(language?.iso).hidePassword:dialogCopy(language?.iso).showPassword}
          onClick={()=>setPasswordVisible(previous=>!previous)}>{passwordVisible?<EyeOff size={20} aria-hidden="true"/>:<Eye size={20} aria-hidden="true"/>}</button>}
        {!labelElement && !!hint && hintElement}
      </div>
      {!!subscription && <div className="element__field_subscription">
        {subscription}
      </div>}
      {type !== 'phone' && !!errorMessage && <div className='element__field_error' id={errorId} role="alert">
        {errorMessage}
      </div>}
      {type !== 'phone' && !!errors[name] && !errorMessage && <div className='element__field_error' id={errorId} role="alert">
        {errors[name]}
      </div>}
    </Wrap>
  )
}

export default JSONFormElement
