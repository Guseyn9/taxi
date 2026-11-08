/** Local acceptance harness for the same adapters used by the r18 frontend. */
import React, { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { saveSessionTokens } from '../security/sessionTokens'
import { FsmPassengerBridge } from '../platform/adapters/FsmPassengerBridge'
import { FsmOrderSnapshotTransport } from '../platform/adapters/FsmOrderSnapshotTransport'

function Acceptance() {
  const [login, setLogin] = useState(`fsm-browser-${Date.now()}@example.invalid`)
  const [password, setPassword] = useState('')
  const [authenticated, setAuthenticated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [orderId, setOrderId] = useState('')
  const [mode, setMode] = useState<'DIRECT' | 'VOTE' | 'OFFER'>('VOTE')
  const [result, setResult] = useState('Готов к проверке локального стенда')
  const stop = useRef<(() => void) | null>(null)
  const bridge = () => new FsmPassengerBridge(`${window.location.origin}/fsm`)
  async function run(action: () => Promise<void>) {
    setBusy(true); setResult('Ожидаю подтверждения сервера…')
    try { await action() } catch (error) { setResult(`Не подтверждено: ${(error as any)?.code || 'ошибка связи'}`) } finally { setBusy(false) }
  }
  async function core(path: string, data: Record<string, unknown>) {
    const body = new FormData()
    Object.entries(data).forEach(([key, value]) => body.set(key, String(value)))
    const response = await (await fetch(`/core/${path}`, { method: 'POST', body })).json()
    if (String(response.code) !== '200' || response.status !== 'success') throw new Error('Core rejected the fixture')
    return response
  }
  return <main style={{maxWidth:720,margin:'40px auto',padding:20,fontFamily:'system-ui'}}>
    <h1>FSM: локальная приёмка</h1>
    <p>Наши адаптеры фронтенда → FSM → настоящий PHP Core. Только синтетические данные.</p>
    <label>Email <input aria-label="Email" value={login} onChange={e => setLogin(e.target.value)} /></label>{' '}
    <label>Пароль <input aria-label="Пароль" type="password" value={password} onChange={e => setPassword(e.target.value)} /></label>
    <p><button disabled={busy || !password} onClick={() => run(async() => {
      await core('register', {u_role:1,u_phone:'2126'+Date.now().toString().slice(-8),u_email:login,u_name:'FSM browser fixture',data:JSON.stringify({password})})
      setResult('Локальный аккаунт создан')
    })}>Создать тестовый аккаунт</button>{' '}
    <button disabled={busy || !password} onClick={() => run(async() => {
      const auth = await core('auth', {login,password,type:'e-mail',au:'f'})
      const token = await core('token', {auth_hash:auth.auth_hash})
      stop.current?.(); saveSessionTokens({token:token.data.token,u_hash:token.data.u_hash})
      setAuthenticated(true); setResult('Вход подтверждён Core')
    })}>Войти</button></p>
    <label>Режим <select aria-label="Режим" disabled={busy} value={mode} onChange={e => setMode(e.target.value as any)}><option>VOTE</option><option>OFFER</option><option>DIRECT</option></select></label>{' '}
    <button disabled={busy || !authenticated} onClick={() => run(async() => {
      const id = await bridge().create({b_start_address:'Avenue Hassan II, Agadir',b_start_latitude:30.4206,b_start_longitude:-9.598,b_destination_address:'Place Al Amal, Agadir',b_destination_latitude:30.4242,b_destination_longitude:-9.596,b_start_datetime:'now',b_car_class:1,b_payment_way:1,b_passengers_count:1,b_cars_count:1,b_location_class:1,b_currency:'GHS',b_max_waiting:7200,b_services:mode==='VOTE'?[5]:[1],b_options:mode==='OFFER'?{offer_mode:'OFFER',customer_price:150}:{}}, mode)
      setOrderId(id); setResult(`Создание подтверждено. Core ID: ${id}`)
    })}>Создать заказ</button>
    <p>Core ID: <output data-testid="order-id">{orderId || '—'}</output></p>
    <button disabled={busy || !orderId} onClick={() => run(async() => {await bridge().command(orderId,'vote_requested');setResult('Голосование подтверждено')})}>Подтвердить голосование</button>{' '}
    <button disabled={busy || !orderId} onClick={() => run(async() => {await bridge().command(orderId,'cancel_requested',{reason:'Local browser acceptance'});setResult('Отмена подтверждена')})}>Отменить заказ</button>{' '}
    <button disabled={busy || !orderId} onClick={() => run(async() => {
      const transport = new FsmOrderSnapshotTransport({apiUrl:`${window.location.origin}/fsm`,orderId,useSessionAuth:true,useCoreOrderIds:true})
      const display = (value: any) => {const snapshot=value.state.domainOrder.snapshot;setResult(JSON.stringify({orderId:snapshot.orderId,state:snapshot.state,sync:snapshot.sync},null,2))}
      display(await transport.loadSnapshot());stop.current?.();stop.current=transport.subscribeSnapshots(display)
    })}>Snapshot + WebSocket</button>
    <pre role="status" style={{whiteSpace:'pre-wrap',background:'#f4f4f4',padding:16}}>{result}</pre>
  </main>
}
createRoot(document.getElementById('root')!).render(<Acceptance />)
