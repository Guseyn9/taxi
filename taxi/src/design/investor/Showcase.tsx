import {taxiColor,taxiPicture} from '../maps/taxiPalette'
import React, {useEffect, useRef, useState} from 'react'
import L from 'leaflet'
import {MapContainer, Marker, Polyline, Tooltip, useMap} from 'react-leaflet'
import {maplibreGL} from '@maplibre/maplibre-gl-leaflet'
import {setWorkerUrl, setWorkerCount} from 'maplibre-gl'
import {Car, CarTaxiFront, ArrowUpRight, Menu, UserRound, MapPin, Clock3, UsersRound, SlidersHorizontal, Check, Phone, MessageCircle, ShieldCheck, Star, Navigation, Flag, Plus, Minus, Play, Pause, ChevronRight, X, Banknote, ArrowLeft} from 'lucide-react'
import {Button} from '../../components/ui/button'
import SmoothRotatingMarker from '../../components/SmoothRotatingMarker'
import VehicleArtwork from '../../components/CarClassSlider/VehicleArtwork'
import {createMapStyle, MAP_ATTRIBUTION} from '../maps/rsale-style'
import {PASSENGER} from '../maps/markers/assets'
import roads from './routes.json'
import './showcase.css'

type Point=[number,number]
const approach=roads.approach as Point[], trip=roads.trip as Point[]
const pickup=trip[0], destination=trip[trip.length-1]
const passengerIcon=L.icon({iconUrl:PASSENGER,iconSize:[46,58],iconAnchor:[23,49]})
const destinationIcon=L.divIcon({className:'investor-destination',html:'<span>B</span>',iconSize:[32,32],iconAnchor:[16,16]})
const stages=['Начальный экран','Маршрут заполнен','Поиск такси','Машина едет к пассажиру','Машина на месте','Поездка','Прибытие']
const titles=['Куда поедем?','Всё готово к поездке','Ищем вам такси','Такси уже едет','Водитель на месте','Хорошей поездки!','Вы приехали']
const lengths=(path:Point[])=>path.map((p,i)=>i?L.latLng(path[i-1]).distanceTo(L.latLng(p)):0)
export function position(path:Point[],progress:number):Point {
 const parts=lengths(path);let left=parts.reduce((a,b)=>a+b,0)*progress
 for(let i=1;i<path.length;i++){if(left<=parts[i]){const f=parts[i]?left/parts[i]:0;return [path[i-1][0]+(path[i][0]-path[i-1][0])*f,path[i-1][1]+(path[i][1]-path[i-1][1])*f]}left-=parts[i]}
 return path[path.length-1]
}
setWorkerUrl('/maps/maplibre-gl-worker.mjs');setWorkerCount(2)
export function Basemap(){
 const map=useMap(),[ready,setReady]=useState(false)
 useEffect(()=>{
  let vector:L.MaplibreGL|undefined,fallback:L.TileLayer|undefined,disposed=false
  const attribution=L.control.attribution({position:'bottomright',prefix:false}).addTo(map);attribution.addAttribution(MAP_ATTRIBUTION)
  const timer=setTimeout(()=>{if(disposed)return;if(vector&&map.hasLayer(vector))map.removeLayer(vector);fallback=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);setReady(true)},20000)
  try{vector=maplibreGL({style:createMapStyle('fr'),attributionControl:false}).addTo(map);const renderer=vector.getMaplibreMap();renderer.once('load',()=>{if(!disposed){clearTimeout(timer);setReady(true)}});renderer.on('error',()=>{})}catch{/* Raster recovery is bounded by the timer. */}
  return()=>{disposed=true;clearTimeout(timer);if(vector&&map.hasLayer(vector))map.removeLayer(vector);if(fallback&&map.hasLayer(fallback))map.removeLayer(fallback);attribution.remove()}
 },[map])
 return ready?null:<div className="investor-map-loading" role="status">Загружаем карту…</div>
}
export function Camera({stage}:{stage:number}){
 const map=useMap()
 useEffect(()=>{const fit=()=>{map.invalidateSize();const points=stage===0?[...approach,...trip]:stage===3||stage===4?approach:trip;map.fitBounds(L.latLngBounds(points),{paddingTopLeft:[56,70],paddingBottomRight:[56,70],maxZoom:stage===0?15:17,animate:false})};fit();const observer=new ResizeObserver(fit);observer.observe(map.getContainer());return()=>observer.disconnect()},[stage,map])
 return <div className="investor-map-tools"><span><MapPin size={15}/> Агадир, Марокко</span><div><button aria-label="Приблизить" onClick={()=>map.zoomIn()}><Plus/></button><button aria-label="Отдалить" onClick={()=>map.zoomOut()}><Minus/></button></div></div>
}
function RouteFields({filled,onFill,compact=false}:{filled:boolean;onFill?:()=>void;compact?:boolean}){
 return <div className={`investor-addresses ${compact?'is-compact':''}`}>
  <label><span className="investor-route-dot is-pickup"/><span><small>Откуда</small><input aria-label="Адрес подачи" readOnly value={filled?'Avenue Hassan II':''} placeholder="Адрес подачи" onClick={onFill}/>{filled&&<em>Баттуар, Агадир</em>}</span><MapPin size={21}/></label>
  <label><span className="investor-route-dot is-destination"/><span><small>Куда</small><input aria-label="Адрес назначения" readOnly value={filled?'Place Al Amal':''} placeholder="Куда поедем?" onClick={onFill}/>{filled&&<em>Центр, Агадир</em>}</span><MapPin size={21}/></label>
 </div>
}
export default function Showcase(){
 const [stage,setStage]=useState(0),[controls,setControls]=useState(false),[progress,setProgress]=useState(.48),[playing,setPlaying]=useState(false),[rating,setRating]=useState(0),[notice,setNotice]=useState('')
 const change=(next:number)=>{setStage(Math.max(0,Math.min(6,next)));setProgress(next===4?1:next===5?.48:.38);setPlaying(false);setNotice('')}
 useEffect(()=>{document.documentElement.lang='ru';document.title='Taxi · демонстрация поездки в Агадире'},[])
 useEffect(()=>{if(!playing||![3,5].includes(stage))return;const timer=setInterval(()=>setProgress(p=>Math.min(1,p+.0025)),100);return()=>clearInterval(timer)},[playing,stage])
 useEffect(()=>{if(progress===1)setPlaying(false)},[progress])
 const path=stage===3||stage===4?approach:trip,carPosition=stage===4?position(approach,.95):stage===6?destination:position(path,progress)
 const moving=stage===3||stage===5
 const showNotice=(text:string)=>setNotice(text)
 return <main className="investor-app" data-stage={stage}>
  <header className="investor-header"><button aria-label="Открыть сценарий" onClick={()=>setControls(true)}><Menu size={24}/></button><a className="investor-logo" href="/investor/index.html"><span><ArrowUpRight size={23}/></span>taxi<span className="investor-logo-dot">.</span></a><button className="investor-demo-badge" onClick={()=>setControls(!controls)}>Демо</button><span className="investor-header-spacer"/><span className="investor-locale">RU</span><button aria-label="Профиль демонстрации" onClick={()=>showNotice('Демонстрационный профиль пассажира')} className="investor-profile"><UserRound size={23}/></button></header>
  <div className="investor-workspace">
   <aside className="investor-panel"><div className="investor-panel-body">
    <div className="investor-kind"><MapPin size={17}/> Городская поездка <span>ПЕТИТ</span></div>
    {stage>1&&<button className="investor-back" onClick={()=>change(1)}><ArrowLeft size={17}/> Маршрут</button>}
    <h1>{titles[stage]}</h1>
    {stage<2?<>
     <RouteFields filled={stage===1} onFill={()=>change(1)}/>
     <h2>Выберите машину</h2>
     <div className="investor-car-options"><button className="is-selected" aria-pressed="true"><VehicleArtwork className="investor-car-art" kind="petit" color={taxiColor({point:pickup})}/><span>ПЕТИТ <Check size={18}/></span><small>По городу · до 3 мест</small></button><button onClick={()=>showNotice('В этом сценарии показана городская поездка ПЕТИТ')}><VehicleArtwork className="investor-car-art" kind="grand" color={taxiColor({point:pickup,kind:'grand'})}/><span>ГРАНД</span><small>Между городами</small></button></div>
     <div className="investor-options"><span><Clock3 size={19}/> Сейчас</span><span><UsersRound size={19}/> 1</span><button onClick={()=>showNotice('Сценарий: один пассажир, наличные, без дополнительных остановок')}><SlidersHorizontal size={18}/> Параметры</button></div>
    </>:<>
     {stage===2?<div className="investor-search"><span className="investor-search-ring"><Navigation size={30}/></span><h2>Подбираем водителя</h2><p>Ваш маршрут отправлен.<br/>Как только водитель примет заказ,<br/>вы увидите его на карте.</p></div>:<>
      {stage===6?<div className="investor-success"><span><Check size={34}/></span><p>Спасибо за поездку</p></div>:<div className="investor-eta"><strong>{stage===3?'3':stage===4?'✓':'4'}</strong><span>{stage===3?'минуты до подачи':stage===4?'машина у точки посадки':'минуты до прибытия'}<small>{stage===3?'Водитель едет к вам':stage===4?'Можно выходить':'Едем на Place Al Amal'}</small></span></div>}
      <div className="investor-driver"><div className="investor-driver-avatar"><UserRound size={27}/></div><div><strong>Юсеф <span>Демо</span></strong><small>Городское такси · красное</small></div><img src={taxiPicture(taxiColor({point:pickup}),'side','petit')} alt="ПЕТИТ · демо"/></div>
      {stage!==6&&<div className="investor-contact"><Button variant="secondary" onClick={()=>showNotice('Демонстрация: звонок водителю не выполняется')}><Phone size={18}/> Позвонить</Button><Button variant="secondary" onClick={()=>showNotice('Демонстрация: сообщения не отправляются')}><MessageCircle size={18}/> Написать</Button></div>}
     </>}
     <RouteFields filled compact/>
     {stage===4&&<div className="investor-boarding"><span>Код посадки<small>Назовите водителю</small></span><strong>111</strong></div>}
     {stage===5&&<div className="investor-safety"><ShieldCheck size={21}/><span>Поездка началась<small>Маршрут и водитель под рукой</small></span></div>}
     {stage===6&&<><div className="investor-fare"><span>Стоимость поездки<small>Условная цена для демо</small></span><strong>25 <small>MAD</small></strong></div><div className="investor-rating"><p>Как прошла поездка?</p><div>{[1,2,3,4,5].map(n=><button aria-label={`Оценить на ${n}`} aria-pressed={rating>=n} key={n} onClick={()=>setRating(n)}><Star size={29} fill={rating>=n?'#b51218':'none'}/></button>)}</div></div></>}
    </>}
    {notice&&<p className="investor-notice" role="status">{notice}</p>}
   </div>
   <footer className="investor-panel-footer">
    {stage<2?<>{stage===1&&<p className="investor-demo-price-note">Условная цена для демо</p>}<div className="investor-mode"><span className="is-current">Такси</span><span>Голосование</span><span>Своя цена</span></div><Button onClick={()=>change(stage===0?1:2)} className="investor-primary"><CarTaxiFront size={22}/>{stage===0?'Куда поедем?':'Найти такси'}{stage===1&&<span className="investor-button-fare">25 MAD</span>}</Button></>:stage===2?<Button variant="outline" onClick={()=>change(1)} className="investor-primary">Отменить поиск</Button>:stage===6?<Button className="investor-primary" onClick={()=>change(0)}>Новая поездка</Button>:<div className="investor-payment"><Banknote size={21}/><span>Наличные</span><strong>25 MAD</strong></div>}
   </footer></aside>
   <section className="investor-map" aria-label="Карта поездки в Агадире"><MapContainer center={pickup} zoom={15} zoomControl={false} attributionControl={false} style={{height:'100%',width:'100%'}}><Basemap/><Camera stage={stage}/>
    {stage>0&&<><Polyline positions={trip} pathOptions={{color:stage<3?'#b51218':'#bcbcbc',weight:5,opacity:stage<3?.9:.65}}/>{stage!==6&&<Marker position={destination} icon={destinationIcon}><Tooltip direction="top" permanent offset={[0,-18]} className="investor-map-label">Place Al Amal</Tooltip></Marker>}</>}
    {stage!==5&&stage!==6&&<Marker position={pickup} icon={passengerIcon} alt="Пассажир"><Tooltip direction="top" permanent offset={[0,-45]} className="investor-map-label">{stage===0?'Вы здесь':'Место посадки'}</Tooltip></Marker>}
    {stage===3||stage===4?<Polyline positions={approach} pathOptions={{color:'#b51218',weight:5,opacity:.9}}/>:null}
    {stage===5&&<Polyline positions={trip} pathOptions={{color:'#b51218',weight:5,opacity:.9}}/>}
    {stage>=3&&<SmoothRotatingMarker key={stage} position={carPosition} path={path} iconUrl={taxiPicture(taxiColor({point:trip[0]}))} iconSize={[64,64]} iconAnchor={[32,32]} speedKmh={80} zIndexOffset={2000} className="smooth-rotating-marker rs-taxi-marker"><Tooltip direction={stage===4?'right':'top'} permanent offset={stage===4?[34,0]:[0,-30]} className="investor-map-label">{stage===3?'Такси едет к вам':stage===4?'Ваше такси':stage===5?'Вы в пути':'Place Al Amal · Вы приехали'}</Tooltip></SmoothRotatingMarker>}
   </MapContainer>{stage>=3&&stage<6&&<div className="investor-map-trip-status"><span className="investor-status-dot"/>{stage===3?'Водитель в пути':stage===4?'Ожидает пассажира':'Поездка выполняется'}</div>}</section>
  </div>
  {controls&&<div className="investor-controls" role="dialog" aria-label="Управление демонстрацией"><div><strong>Сценарий поездки</strong><button aria-label="Закрыть управление" onClick={()=>setControls(false)}><X size={20}/></button></div><label>Экран<select aria-label="Экран демонстрации" value={stage} onChange={e=>change(Number(e.target.value))}>{stages.map((name,i)=><option value={i} key={name}>{i+1}. {name}</option>)}</select></label>{moving&&<><label>Положение машины<input aria-label="Положение машины" type="range" min="0" max="100" step="1" value={progress*100} onChange={e=>{setPlaying(false);setProgress(Number(e.target.value)/100)}}/></label><Button variant="secondary" onClick={()=>setPlaying(!playing)}>{playing?<Pause size={17}/>:<Play size={17}/>} {playing?'Пауза':'Движение по дороге'}</Button></>}<Button onClick={()=>{change(stage===6?0:stage+1);setControls(false)}}>Следующий экран <ChevronRight size={18}/></Button><p>Локальный сценарий. Заказы не создаются, GPS и данные водителя демонстрационные.</p></div>}
 </main>
}
