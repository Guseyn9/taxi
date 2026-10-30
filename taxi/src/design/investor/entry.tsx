import React from 'react'
import {createRoot} from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import 'maplibre-gl/dist/maplibre-gl.css'
import '../shadcn.generated.css'
import '../rsale.css'
import '../maps/markers/markers.css'
import Showcase from './Showcase'
import DriverShowcase from './DriverShowcase'
import '../route-icons.css'

// Separate entry point: no Redux store, authentication, order gateway or backend bootstrap.
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).get('view')==='driver'?<DriverShowcase/>:<Showcase/>)
