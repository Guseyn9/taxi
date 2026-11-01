import {taxiColor,taxiPicture} from '../maps/taxiPalette'
import React,{useEffect,useState} from 'react'
import L from 'leaflet'
import {MapContainer,Marker,Polyline,Tooltip} from 'react-leaflet'
import {ArrowUpRight,Menu,CarTaxiFront,UserRound,MapPin,Navigation,Check,Clock3,UsersRound,Banknote,MessageCircle,Phone,ChevronRight,X,Star,ArrowLeft,Play,Pause} from 'lucide-react'
import {Button} from '../../components/ui/button'
import SmoothRotatingMarker from '../../components/SmoothRotatingMarker'
import {PASSENGER} from '../maps/markers/assets'
import {Basemap,Camera,position} from './Showcase'
import roads from './routes.json'
import './driver-showcase.css'

type Point=[number,number]
const approach=roads.approach as Point[],trip=roads.trip as Point[]
const pickup=trip[0],destination=trip[trip.length-1]
const person=L.icon({iconUrl:PASSENGER,iconSize:[46,58],iconAnchor:[23,49]})
const finish=L.divIcon({className:'investor-destination',html:'<span>B</span>',iconSize:[32,32],iconAnchor:[16,16]})
const stages=['Доступные заказы','Детали заказа','На подаче','Посадка пассажира','В поездке','Поездка завершена']
const titles=['Заказы рядом','Новый заказ','Едем к пассажиру','Вы на месте','Поездка началась','Поездка завершена']
function Route({compact=false}:{compact?:boolean}){
 return <div className={`driver-demo-route ${compact?'is-compact':''}`}><div><span className="driver-demo-route-start"/><p><small>Откуда</small><strong>Avenue Hassan II</strong><em>Баттуар, Агадир</em></p></div><div><span className="driver-demo-route-end"/><p><small>Куда</small><strong>Place Al Amal</strong><em>Центр, Агадир</em></p></div></div>
}
export default function DriverShowcase(){
 const [stage,setStage]=useState(0),[controls,setControls]=useState(false),[progress,setProgress]=useState(.4),[playing,setPlaying]=useState(false),[notice,setNotice]=useState(''),[code,setCode]=useState(''),[rating,setRating]=useState(0)
 const change=(next:number)=>{setStage(Math.max(0,Math.min(5,next)));setNotice('');setPlaying(false);setProgress(.4);setCode('');setRating(0)}
 useEffect(()=>{document.documentElement.lang='ru';document.title='Taxi · водитель · демонстрация в Агадире'},[])
 useEffect(()=>{if(!playing||![2,4].includes(stage))return;const id=setInterval(()=>setProgress(p=>Math.min(1,p+.003)),100);return()=>clearInterval(id)},[playing,stage])
 useEffect(()=>{if(progress>=1)setPlaying(false)},[progress])
 const path=stage<4?approach:trip
 const car=stage===3?position(approach,.95):stage===5?destination:position(path,stage<2?.16:progress)
 const next=()=>{if(stage===3&&code!=='111'){setNotice('В демо используйте код 111.');return}change(stage===5?0:stage+1)}
 return <main className="investor-app driver-demo" data-driver-stage={stage}>
  <header className="investor-header"><button aria-label="Открыть сценарий водителя" onClick={()=>setControls(true)}><Menu size={24}/></button><a className="investor-logo" href="/investor/index.html?view=driver"><span><ArrowUpRight size={23}/></span>taxi<span className="investor-logo-dot">.</span></a><span className="driver-demo-role">Водитель</span><button className="investor-demo-badge" onClick={()=>setControls(!controls)}>Демо</button><span className="investor-header-spacer"/><span className="driver-demo-online"><i/>На линии</span><span className="investor-locale">RU</span><button className="investor-profile" aria-label="Демонстрационный профиль водителя" onClick={()=>setNotice('Юсеф · ПЕТИТ · демонстрационный профиль')}><UserRound size={22}/></button></header>
  <div className="investor-workspace"><aside className="investor-panel"><div className="investor-panel-body">
   <div className="driver-demo-context"><span><MapPin size={15}/>Агадир</span><span>ПЕТИТ</span></div>
   {stage>0&&stage<5&&<button className="investor-back" onClick={()=>change(0)}><ArrowLeft size={16}/>К заказам</button>}
   <h1>{titles[stage]}</h1>
   {stage===0?<><div className="driver-demo-tabs"><button aria-pressed="true">Доступные <span>1</span></button><button onClick={()=>change(5)}>История</button></div><button className="driver-demo-request" onClick={()=>change(1)}><div className="driver-demo-request-head"><span>Городская поездка</span><b>25 <small>MAD</small></b></div><Route compact/><div className="driver-demo-request-foot"><span><UsersRound size={16}/>1 пассажир</span><span><Banknote size={16}/>Наличные</span><ChevronRight size={18}/></div></button><p className="driver-demo-help">Откройте заказ, чтобы посмотреть маршрут и принять поездку.</p></>:<>
    {stage===5?<div className="driver-demo-complete"><span><Check size={31}/></span><p>Пассажир прибыл на Place Al Amal</p><strong>25 <small>MAD</small></strong><em>Наличные · условная сумма демо</em></div>:<>
     {stage===1?<div className="driver-demo-fare"><div><small>Стоимость поездки</small><strong>25 <span>MAD</span></strong></div><span><Banknote size={18}/>Наличные</span></div>:<div className="driver-demo-eta"><span className="driver-demo-status-icon">{stage===3?<Check size={27}/>:<Navigation size={26}/>}</span><div><strong>{stage===2?'≈ 3 минуты до пассажира':stage===3?'Ожидаем посадку':'≈ 4 минуты до прибытия'}</strong><small>{stage===2?'Avenue Hassan II':stage===3?'Avenue Hassan II · место подачи':'Place Al Amal · пункт назначения'}</small></div></div>}
     <div className="driver-demo-person"><span><UserRound size={22}/></span><div><strong>Пассажир</strong><small>1 человек · демонстрационный заказ</small></div><span className="driver-demo-person-tag">ПЕТИТ</span></div>
     <Route compact={stage>1}/>
     {stage===1?<div className="driver-demo-facts"><span><Clock3 size={18}/><small>Подача</small><b>≈ 3 мин</b></span><span><UsersRound size={18}/><small>Пассажиры</small><b>1 человек</b></span></div>:<div className="investor-contact"><Button variant="secondary" onClick={()=>setNotice('Демонстрация: звонок не выполняется')}><Phone size={17}/>Позвонить</Button><Button variant="secondary" onClick={()=>setNotice('Демонстрация: сообщение не отправляется')}><MessageCircle size={17}/>Написать</Button></div>}
     {stage===3&&<label className="driver-demo-code"><span>Код посадки<small>В демонстрации: 111</small></span><input aria-label="Код посадки" inputMode="numeric" maxLength={3} placeholder="•••" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))}/></label>}
     {stage===4&&<p className="driver-demo-trip-note"><UsersRound size={18}/>Пассажир в салоне</p>}
    </>}
    {stage===5&&<><Route compact/><div className="investor-rating"><p>Как прошла поездка?</p><div>{[1,2,3,4,5].map(n=><button aria-label={`Оценить пассажира на ${n}`} aria-pressed={rating>=n} key={n} onClick={()=>setRating(n)}><Star size={27} fill={rating>=n?'#b51218':'none'}/></button>)}</div></div></>}
   </>}
   {notice&&<p className="investor-notice" role="status">{notice}</p>}
  </div><footer className="investor-panel-footer">{stage===0?<div className="driver-demo-shift"><span><i/>Приём заказов включён</span><small>Юсеф · Dacia Logan · ПЕТИТ</small></div>:<>{stage>1&&stage<5&&<div className="driver-demo-footer-fare"><span>Наличные</span><strong>25 MAD</strong></div>}<Button className="investor-primary" onClick={next}>{stage===1?<CarTaxiFront size={21}/>:stage===5?<Navigation size={20}/>:<Check size={20}/ >}{['','Принять заказ','Я на месте','Подтвердить посадку','Завершить поездку','К новым заказам'][stage]}</Button></>}</footer></aside>
  <section className="investor-map" aria-label="Карта водителя в Агадире"><MapContainer center={pickup} zoom={16} zoomControl={false} attributionControl={false} style={{height:'100%',width:'100%'}}><Basemap/><Camera stage={stage===2||stage===3?3:stage===0?0:5}/>
   <Polyline positions={trip} pathOptions={{color:stage===1||stage>=4?'#b51218':'#bdbdbd',weight:5,opacity:stage===1||stage>=4?.9:.6}}/>
   {stage<4&&stage!==1&&<Polyline positions={approach} pathOptions={{color:'#b51218',weight:5,opacity:.9}}/>}
   {stage<4&&<Marker position={pickup} icon={person} alt="Пассажир на месте посадки"><Tooltip direction="top" permanent offset={[0,-45]} className="investor-map-label">Пассажир · Avenue Hassan II</Tooltip></Marker>}
   {stage!==5&&<Marker position={destination} icon={finish}><Tooltip direction="top" permanent offset={[0,-18]} className="investor-map-label">Place Al Amal</Tooltip></Marker>}
   <SmoothRotatingMarker key={stage} position={car} path={path} iconUrl={taxiPicture(taxiColor({point:trip[0]}))} iconSize={[64,64]} iconAnchor={[32,32]} speedKmh={80} zIndexOffset={2000} className="smooth-rotating-marker rs-taxi-marker"><Tooltip direction={stage===3?'right':'top'} permanent offset={stage===3?[34,0]:[0,-30]} className="investor-map-label">{stage===3?'Вы на месте':stage===5?'Поездка завершена':'Ваш автомобиль'}</Tooltip></SmoothRotatingMarker>
  </MapContainer><div className="investor-map-trip-status"><span className="investor-status-dot"/>{['Ожидание заказа','Маршрут нового заказа','На подаче','Ожидание пассажира','Пассажир в салоне','Маршрут завершён'][stage]}</div></section></div>
  {controls&&<div className="investor-controls" role="dialog" aria-label="Сценарий водителя"><div><strong>Экраны водителя</strong><button aria-label="Закрыть управление" onClick={()=>setControls(false)}><X size={20}/></button></div><label>Состояние<select aria-label="Экран водителя" value={stage} onChange={e=>change(Number(e.target.value))}>{stages.map((name,i)=><option value={i} key={name}>{i+1}. {name}</option>)}</select></label>{[2,4].includes(stage)&&<><label>Положение машины<input aria-label="Положение машины" type="range" min="0" max="100" value={progress*100} onChange={e=>{setPlaying(false);setProgress(Number(e.target.value)/100)}}/></label><Button variant="secondary" onClick={()=>setPlaying(!playing)}>{playing?<Pause size={17}/>:<Play size={17}/ >}{playing?'Пауза':'Движение по дороге'}</Button></>}<Button onClick={()=>{change(stage===5?0:stage+1);setControls(false)}}>Следующий экран<ChevronRight size={17}/></Button><p>Отдельное демо. Заказы, цена, время и движение условные; обращения к backend отсутствуют.</p></div>}
 </main>
}
