import '../App.scss'
import '../design/drive-v2/tokens.css'
import React from 'react'
import {createRoot} from 'react-dom/client'
import GraphDiagnostics from '../graph/Diagnostics'
createRoot(document.getElementById('root')!).render(<main style={{padding:24,background:'white',height:'100%',overflow:'auto',fontFamily:'Manrope,sans-serif'}}><h1>QA · дорожный граф</h1><p>Только локальные файлы и IndexedDB. Без backend и заказов.</p><GraphDiagnostics iso="ru"/></main>)
