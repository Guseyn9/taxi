import './preBootstrap'
import { startRuntimeHealth } from './diagnostics/runtimeHealth'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Provider } from 'react-redux'
import { HelmetProvider } from 'react-helmet-async'
import store from './state'
import App from './App'
import { LocalizationProvider } from '@mui/x-date-pickers'
import { AdapterMoment } from '@mui/x-date-pickers/AdapterMoment'

import * as serviceWorker from './serviceWorker'
import './design/shadcn.generated.css'
import './design/rsale.css'
import './design/mobile.css'
import './design/address-fields.css'
import './design/trip-options.css'
import './design/system-ui.css'
import './design/driver-chat.css'
import './design/mobile-driver.css'
import './design/mobile-dialogs.css'
import './design/mobile-journey.css'
import './design/order-switcher.css'
import './design/mobile-card-modal.css'
import './design/mobile-chat-status.css'
import './design/mobile-viewport'
import './design/drive-v2/tokens.css'
import './design/drive-v2/surfaces.css'
import './design/drive-v2/booking-layout.css'
import './design/drive-v2/comfort-layout.css'
import './design/drive-v2/header-layout.css'
import './design/drive-v2/control-layout.css'
import './design/drive-v2/journey-layout.css'
import './design/drive-v2/booking-fit.css'
import './design/drive-v2/auth-layout.css'
import './design/drive-v2/dark-booking.css'
import './design/drive-v2/palette-finish.css'
import './design/drive-v2/review-actions.css'
import './design/drive-v2/review-panel.css'

import './design/trip3d/trip3d.css'

startRuntimeHealth()
createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <Provider store={store}>
        <LocalizationProvider dateAdapter={AdapterMoment}>
          <HelmetProvider>
            <App/>
          </HelmetProvider>
        </LocalizationProvider>
      </Provider>
    </BrowserRouter>
  </React.StrictMode>,
)

serviceWorker.unregister()
