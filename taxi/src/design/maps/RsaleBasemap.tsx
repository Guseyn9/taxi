import React, { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { useMap } from 'react-leaflet'
import { useSelector } from 'react-redux'
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet'
import { setWorkerUrl, setWorkerCount } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Plus, Minus, RotateCcw, Maximize2, Minimize2 } from 'lucide-react'
import { configSelectors } from '../../state/config'
import { Button } from '../../components/ui/button'
import { createMapStyle, MAP_ATTRIBUTION } from './rsale-style'
import { MOROCCO_VIEW, MOROCCO_ZOOM, MOROCCO_MAX_ZOOM, moroccoCities, canApplyInitialOverview, moroccoMinimumZoom } from './morocco'
import './maps.css'
import OnMapPreview from './markers/OnMapPreview'
import {TEST_MAP_AREA_EVENT} from './TestMapArea'


setWorkerUrl('/maps/maplibre-gl-worker.mjs')
setWorkerCount(2)

function mapCopy(iso?: string) {
  if (iso?.startsWith('ru')) return { country: 'Марокко', area: 'Область карты', zoomIn: 'Приблизить', zoomOut: 'Отдалить', loading: 'Загружаем карту…', fallback: 'Упрощённая карта', retry: 'Повторить загрузку' }
  if (iso?.startsWith('fr')) return { country: 'Maroc', area: 'Zone de la carte', zoomIn: 'Zoom avant', zoomOut: 'Zoom arrière', loading: 'Chargement de la carte…', fallback: 'Carte simplifiée', retry: 'Réessayer' }
  if (iso?.toLowerCase().includes('arab') || iso === 'ar') return { country: 'المغرب', area: 'منطقة الخريطة', zoomIn: 'تكبير', zoomOut: 'تصغير', loading: 'جار تحميل الخريطة…', fallback: 'خريطة مبسطة', retry: 'إعادة المحاولة' }
  return { country: 'Morocco', area: 'Map area', zoomIn: 'Zoom in', zoomOut: 'Zoom out', loading: 'Loading map…', fallback: 'Simplified map', retry: 'Retry map' }
}

export function viewportPadding(map: L.Map) {
  const mapBox = map.getContainer().getBoundingClientRect()
  const surface = map.getContainer().closest('.passenger')
  const sheet = surface?.querySelector('.passenger__form-container')?.getBoundingClientRect()
  const desktop = window.matchMedia('(min-width: 900px), (min-width: 600px) and (max-width: 899px) and (max-height: 500px) and (orientation: landscape)').matches
  const card = surface?.querySelector('.passenger__draggable')?.getBoundingClientRect()
  const visibleHeight = !desktop && card ? Math.max(48, card.top - mapBox.top) : mapBox.height
  map.getContainer().style.setProperty('--rs-map-visible-height', desktop ? '100%' : `${visibleHeight}px`)
  const coveredBottom = !desktop && sheet ? Math.max(0, mapBox.top + visibleHeight - sheet.top) : 0
  const coveredLeft = window.matchMedia('(min-width: 900px)').matches && sheet ?
    Math.max(0, Math.min(sheet.right - mapBox.left + 16, mapBox.width - 240)) : 0
  map.getContainer().style.setProperty('--rs-map-covered-bottom', `${coveredBottom}px`)
  return {
    paddingTopLeft: L.point(Math.max(18, coveredLeft), 16),
    paddingBottomRight: L.point(18, Math.min(coveredBottom + 12, Math.max(12, visibleHeight - 48))),
  }
}

/** A display layer only. Existing Leaflet routes, events, markers and order state stay in place. */
export default function RsaleBasemap({ initialOverview = false, showRegionControls = true }: { initialOverview?: boolean, showRegionControls?: boolean }) {
  const map = useMap()
  const language = useSelector(configSelectors.language)
  const locale = language?.iso?.split('-')[0] || 'fr'
  const copy = mapCopy(locale)
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>('loading')
  const [revision, setRevision] = useState(0)
  const [fullMap,setFullMap]=useState(false)
  const controls = useRef<HTMLDivElement>(null)
  const initialViewApplied = useRef(false)
  const cameraChanged = useRef(false)
  const [zoomLimits,setZoomLimits] = useState({atMin:false,atMax:false})

  useEffect(() => {
    const region = L.latLngBounds(MOROCCO_VIEW)
    const update = () => {
      const size=map.getSize()
      if (!size.x || !size.y) return
      const minimum = moroccoMinimumZoom(map.getBoundsZoom(region,true))
      if (map.getMinZoom() !== minimum) map.setMinZoom(minimum)
      map.panInsideBounds(region,{animate:false})
      setZoomLimits({atMin:map.getZoom()<=minimum,atMax:map.getZoom()>=MOROCCO_MAX_ZOOM})
    }
    update()
    map.on('resize zoomend',update)
    return () => {map.off('resize zoomend',update)}
  }, [map])

  useEffect(() => {
    const preserveCamera = () => { cameraChanged.current = true }
    map.on('dragstart locationfound', preserveCamera)
    const container = map.getContainer()
    container.addEventListener('wheel', preserveCamera, { passive: true })
    container.addEventListener('keydown', preserveCamera)
    return () => {
      map.off('dragstart locationfound', preserveCamera)
      container.removeEventListener('wheel', preserveCamera)
      container.removeEventListener('keydown', preserveCamera)
    }
  }, [map])

  useEffect(() => {
    let disposed = false
    let vector: L.MaplibreGL | undefined
    let fallback: L.TileLayer | undefined
    const attribution = L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map)
    attribution.addAttribution(MAP_ATTRIBUTION)
    setStatus('loading')
    const useFallback = () => {
      if (disposed || fallback) return
      if (vector && map.hasLayer(vector)) map.removeLayer(vector)
      vector = undefined
      attribution.removeAttribution(MAP_ATTRIBUTION)
      attribution.addAttribution('&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors')
      fallback = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { minZoom:MOROCCO_ZOOM,maxZoom:MOROCCO_MAX_ZOOM,bounds:MOROCCO_VIEW,noWrap:true,keepBuffer:1 }).addTo(map)
      setStatus('fallback')
    }
    const timeout = window.setTimeout(useFallback, 20000)
    try {
      // The Leaflet adapter supports padding (its 0.1 default is in the
      // installed source), although its published type omits this option.
      const layerOptions: Parameters<typeof maplibreGL>[0] & {padding:number} = {
        style:createMapStyle(locale),attributionControl:false,renderWorldCopies:false,padding:0.05,
      }
      vector = maplibreGL(layerOptions).addTo(map)
      const renderer = vector.getMaplibreMap()
      renderer.once('load', () => {
        if (!disposed) { window.clearTimeout(timeout); setStatus('ready') }
      })
      // Errors are contained here; a source outage must never break trip controls.
      renderer.on('error', () => {})
    } catch {
      window.clearTimeout(timeout)
      useFallback()
    }
    return () => {
      disposed = true
      window.clearTimeout(timeout)
      if (vector && map.hasLayer(vector)) map.removeLayer(vector)
      if (fallback && map.hasLayer(fallback)) map.removeLayer(fallback)
      attribution.remove()
    }
  }, [map, locale, revision])

  useEffect(() => {
    const update = () => viewportPadding(map)
    const observer = new ResizeObserver(update)
    observer.observe(map.getContainer())
    const sheet = map.getContainer().closest('.passenger')?.querySelector('.passenger__form-container')
    if (sheet) observer.observe(sheet)
    const frame = window.requestAnimationFrame(() => {
      update()
      if (initialOverview && status !== 'loading' && !initialViewApplied.current) {
        initialViewApplied.current = true
        if (canApplyInitialOverview(initialOverview, cameraChanged.current)) {
          map.fitBounds(MOROCCO_VIEW, { ...viewportPadding(map), animate: false })
        }
      }
    })
    return () => { observer.disconnect(); window.cancelAnimationFrame(frame) }
  }, [map, initialOverview, status])

  useEffect(() => {
    if (controls.current) {
      L.DomEvent.disableClickPropagation(controls.current)
      L.DomEvent.disableScrollPropagation(controls.current)
    }
  }, [])

  useEffect(()=>{
    const select=(event:Event)=>{
      const value=(event as CustomEvent).detail
      const city=moroccoCities.find(item=>item.id===value)
      if(value!=='morocco'&&!city)return
      cameraChanged.current=true
      if(city)map.setView([city.position[0],city.position[1]],13,{animate:false})
      else map.fitBounds(MOROCCO_VIEW,{...viewportPadding(map),animate:false})
    }
    window.addEventListener(TEST_MAP_AREA_EVENT,select)
    return()=>window.removeEventListener(TEST_MAP_AREA_EVENT,select)
  },[map])
  useEffect(()=>{
    const surface=map.getContainer().closest('.passenger,.driver')
    surface?.classList.toggle('taxi-map-fullscreen',fullMap)
    const frame=requestAnimationFrame(()=>map.invalidateSize({pan:false}))
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setFullMap(false)}
    window.addEventListener('keydown',escape)
    return()=>{cancelAnimationFrame(frame);surface?.classList.remove('taxi-map-fullscreen');window.removeEventListener('keydown',escape)}
  },[fullMap,map])

  return <>
    {showRegionControls && <OnMapPreview onCameraChange={()=>{cameraChanged.current=true}}/>}
    {showRegionControls && <div className="rs-map-controls" ref={controls}>
      <Button type="button" variant="outline" size="icon" className="rs-map-fullscreen" aria-pressed={fullMap}
        aria-label={locale==='ru'?(fullMap?'Вернуться к форме':'Развернуть карту'):(fullMap?'Return to booking':'Expand map')}
        onClick={()=>setFullMap(value=>!value)}>{fullMap?<Minimize2 aria-hidden="true"/>:<Maximize2 aria-hidden="true"/>}</Button>
      <div className="rs-map-zoom">
        <Button type="button" variant="outline" size="icon" aria-label={copy.zoomIn} disabled={zoomLimits.atMax} onClick={() => { cameraChanged.current = true; map.zoomIn() }}><Plus aria-hidden="true" /></Button>
        <Button type="button" variant="outline" size="icon" aria-label={copy.zoomOut} disabled={zoomLimits.atMin} onClick={() => { cameraChanged.current = true; map.zoomOut() }}><Minus aria-hidden="true" /></Button>
      </div>
    </div>}
    <div className="rs-map-status" data-testid="rsale-map-status" data-renderer={status === 'fallback' ? 'raster-fallback' : 'maplibre'} data-status={status} role="status">
      {status === 'loading' && copy.loading}
      {status === 'fallback' && <>{copy.fallback}<button type="button" aria-label={copy.retry} onClick={() => setRevision(value => value + 1)}><RotateCcw size={14} />{copy.retry}</button></>}
    </div>
  </>
}
