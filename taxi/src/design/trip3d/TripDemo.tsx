import React, { useEffect, useRef, useState } from 'react'
import { Box, Play, Pause, RotateCcw } from 'lucide-react'
import Overlay from '../../components/modals/Overlay'
import { DURATION, tripFrame } from './motion'

export default function TripDemo() {
  const [open,setOpen]=useState(false)
  const [playing,setPlaying]=useState(false)
  const [time,setTime]=useState(0)
  const [speed,setSpeed]=useState(1)
  const [view,setView]=useState('perspective')
  const [error,setError]=useState(false)
  const [ready,setReady]=useState(false)
  const host=useRef<HTMLDivElement>(null)
  const scene=useRef<ReturnType<typeof import('./scene').createTripScene> | null>(null)
  const clock=useRef({time,playing,speed})
  clock.current={time,playing,speed}
  useEffect(()=>{
    if(!open || !host.current)return
    let disposed=false,frame=0,last=0,lastLabel=0
    setReady(false);setError(false)
    import('./scene').then(({createTripScene})=>{
      if(disposed || !host.current)return
      try {
        scene.current=createTripScene(host.current);setReady(true)
        const render=(now:number)=>{
          if(disposed)return
          const delta=last?Math.min((now-last)/1000,.1):0;last=now
          if(clock.current.playing){clock.current.time=Math.min(DURATION,clock.current.time+delta*clock.current.speed)}
          scene.current?.render(clock.current.time)
          if(now-lastLabel>100 || clock.current.time===DURATION){setTime(clock.current.time);lastLabel=now}
          if(clock.current.time===DURATION){setPlaying(false)}
          frame=requestAnimationFrame(render)
        }
        frame=requestAnimationFrame(render)
      }catch {setError(true);scene.current?.dispose();scene.current=null}
    }).catch(()=>{if(!disposed)setError(true)})
    return()=>{disposed=true;cancelAnimationFrame(frame);scene.current?.dispose();scene.current=null}
  },[open])
  useEffect(()=>{scene.current?.setView(view)},[view,ready])
  const phase=tripFrame(time).phase
  return <>
    <button className="rs-trip-demo-launch" type="button" onClick={()=>setOpen(true)}><Box size={18} aria-hidden="true"/>3D демо</button>
    {open && <Overlay isOpen onClick={()=>{setPlaying(false);setOpen(false)}} wrapperClassName="rs-trip-demo-overlay">
      <section className="rs-trip-demo modal">
        <header><span className="rs-demo-badge">Локальное демо · без заказа</span><h2>Поездка в объёме</h2><p>Условный квартал Марокко. Модели и маршрут демонстрационные.</p></header>
        <div className="rs-trip-scene" ref={host} data-testid="trip-3d-scene" data-ready={ready} data-phase={phase}>
          {!ready && !error && <p role="status">Загружаем 3D…</p>}
          {error && <p role="alert">3D недоступно в этом браузере. Нужен WebGL2.</p>}
          {ready && <div className="rs-scene-key"><span>● Такси</span><span>● Пассажир</span><span>━ Маршрут</span></div>}
        </div>
        <div className="rs-trip-playback">
          <ol aria-label="Этапы демо">{['Подача','Посадка','В пути','Прибытие'].map((label,i)=><li key={label} aria-current={i===phase?'step':undefined} className={i<=phase?'is-reached':''}>{label}</li>)}</ol>
          <label className="rs-demo-seek">Ход поездки <output>{Math.round(time)} / {DURATION} с</output><input type="range" min="0" max={DURATION} step=".1" value={time} aria-label="Ход поездки" onChange={e=>{clock.current.time=Number(e.target.value);setTime(Number(e.target.value))}}/></label>
          <div className="rs-demo-controls"><button type="button" disabled={!ready||error} onClick={()=>{if(time===DURATION){clock.current.time=0;setTime(0)}setPlaying(!playing)}}>{playing?<Pause size={17}/>:<Play size={17}/>} {playing?'Пауза':time===DURATION?'Ещё раз':'Запустить'}</button><button type="button" onClick={()=>{setPlaying(false);clock.current.time=0;setTime(0)}}><RotateCcw size={17}/>Сначала</button><label>Скорость<select aria-label="Скорость демо" value={speed} onChange={e=>setSpeed(Number(e.target.value))}><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label><label>Камера<select aria-label="Камера 3D" value={view} onChange={e=>setView(e.target.value)}><option value="perspective">Объём</option><option value="top">Сверху</option><option value="follow">За машиной</option></select></label></div>
        </div>
      </section>
    </Overlay>}
  </>
}
