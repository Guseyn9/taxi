import React, { useState, useEffect, useRef } from 'react'
import { useSelector } from 'react-redux'
import { configSelectors } from '../../state/config'
import { sandboxCopy, parseSandboxSettings } from './copy'
// import ErrorBoundary from '../components/ErrorBoundary'
import 'jsoneditor/dist/jsoneditor.css'
import _ from 'lodash'
import ConstructorTab from '../../components/ConstructorTab'
import { saveAs } from 'file-saver'
import JSONEditor from 'jsoneditor'
import './styles.sass'
import { useForm, useWatch } from 'react-hook-form'

const Sandbox = () => {
  const language = useSelector(configSelectors.language)
  const copy = sandboxCopy(language?.iso)
  const [fileError, setFileError] = useState<'invalid' | 'readError' | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [settings, setSettings] = useState<{[key: string]: any}>(
    {
      blocks: [{ text: 'hello world' }],
    },
  )
  const [contentKey, setContentKey] = useState(Date.now())
  const editor = useRef<JSONEditor>(null)

  const updateFrameKey = () => {
    setContentKey(Date.now())
  }

  useEffect(() => {
    const onChange = _.debounce(() => {
      try {
        if (editor.current) {
          setSettings(editor.current.get())
          localStorage.setItem('settings', JSON.stringify(editor.current.get()))
        }
        updateFrameKey()
      } catch (error) {
        console.error(error)
      }
    }, 700)
    editor.current = new JSONEditor(
      document.getElementById('settings-editor') as HTMLElement,
      {
        mode: 'code',
        onChange,
      },
      settings,
    )
    const saved = localStorage.getItem('settings')
    const parsed = saved ? parseSandboxSettings(saved) : settings
    if (saved && !parsed) setFileError('invalid')
    const defaultSettings = parsed || settings
    editor.current.set(defaultSettings)
    setSettings(defaultSettings)
    return () => { onChange.cancel(); editor.current?.destroy(); editor.current = null }
  }, [])

  const openFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.length && e.target.files[0]
    if (file) {
      const reader = new window.FileReader()
      reader.readAsText(file, 'UTF-8')
      reader.onload = (event) => {
        const next = typeof event.target?.result === 'string' ? parseSandboxSettings(event.target.result) : null
        if (!next) { setFileError('invalid'); return }
        setFileError(null)
        editor.current?.set(next)
        setSettings(next)
        updateFrameKey()
      }
      reader.onerror = () => {
        setFileError('readError')
      }
    }
  }

  const saveFile = () => {
    saveAs(
      new Blob([JSON.stringify(settings)], {
        type: 'application/json',
      }),
      'data.json',
    )
  }

  const form = useForm(settings.formConfg || {
    criteriaMode: 'all',
    mode: 'onChange',
  })

  const values = useWatch(
    {
      control: form.control,
    },
  )

  return (
    <>
      <div className="columns rs-sandbox">
        <div
          className="column column--editor"
          style={{ position: 'fixed', top: 0, left: 0 }}
        >
          <div
            className="settings-editor-menu"
            style={{
              backgroundColor: '#3883fa',
              height: 30,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <button type="button" className="rs-sandbox-open" onClick={() => fileInput.current?.click()}>{copy.open}</button>
            <input
              ref={fileInput}
              id="json-file"
              aria-label={copy.open}
              type="file"
              name="json-file"
              accept="application/JSON"
              style={{ display: 'none' }}
              onChange={openFile}
            />
            <button type="button" onClick={saveFile}>{copy.save}</button>
            <button type="button" onClick={updateFrameKey}>{copy.refresh}</button>
          </div>
          {fileError && <div role="alert" className="rs-sandbox-error">{copy[fileError]}</div>}
          <div className="settings-editor" id="settings-editor"></div>
        </div>
        <div
          className="column column--content"
          key={contentKey}
        >
          <div
            className="sandbox-content"
            key={contentKey}
            style={{ position: 'relative', minHeight: '100vh' }}
          >
            <form onSubmit={event => { event.preventDefault(); console.log('submit') }}>
              <ConstructorTab
                form={form}
                values={values}
                settings={settings}
              />
            </form>
          </div>
        </div>
      </div>
    </>
  )
}

export default Sandbox