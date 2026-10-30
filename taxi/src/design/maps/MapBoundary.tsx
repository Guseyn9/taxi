import React from 'react'
const labels={ru:['Карта временно недоступна','Данные поездки сохранены. Можно продолжать работу с заказом.','Загрузить карту снова'],en:['Map temporarily unavailable','Trip data is preserved. You can continue using the order.','Reload map'],fr:['Carte temporairement indisponible','Les données du trajet sont conservées. Vous pouvez continuer.','Recharger la carte'],ar:['الخريطة غير متاحة مؤقتاً','تم الاحتفاظ ببيانات الرحلة. يمكنك متابعة استخدام الطلب.','إعادة تحميل الخريطة']}
export default class MapBoundary extends React.Component<{resetKey:string;iso?:string;children:React.ReactNode},{failed:boolean;key:string}>{
 state={failed:false,key:this.props.resetKey}
 static getDerivedStateFromError(){return {failed:true}}
 static getDerivedStateFromProps(props:{resetKey:string},state:{key:string}){return props.resetKey!==state.key?{failed:false,key:props.resetKey}:null}
 componentDidCatch(error:unknown){console.error('[Map render]',error)}
 render(){const copy=labels[(this.props.iso||'en').split('-')[0] as keyof typeof labels]||labels.en;return this.state.failed?<div className="ride-map-recovery" role="status"><strong>{copy[0]}</strong><p>{copy[1]}</p><button type="button" onClick={()=>this.setState({failed:false})}>{copy[2]}</button></div>:this.props.children}
}
