import ConnectionBar from './design/reliability/ConnectionBar'
import React, { useEffect } from 'react'
import { notifyNativeStartup } from './tools/nativeStartup'
import { recordPlatformProvider } from './diagnostics/platformProvider'
import { applyUiDocumentLanguage } from './design/ui-language'
import './design/rtl.css'
import { subscribeSessionRevocation } from './security/sessionTokens'
import { ActionTypes as UserActionTypes } from './state/user/constants'
import { clearOrders } from './state/orders/actionCreators'
import { refreshOrder, refreshActiveOrders, refreshReadyOrders } from './state/orders/actionCreators'
import {subscribeOrderWake} from './tools/orderWake'
import { connect, ConnectedProps } from 'react-redux'
import { Helmet } from 'react-helmet-async'
import SITE_CONSTANTS from './siteConstants'
import store, { IRootState } from './state'
import { configSelectors } from './state/config'
import { userActionCreators } from './state/user'
import { userSelectors } from './state/user'
import { EUserRoles } from './types/types'
import Theme from './components/Theme'
import { ModalHost } from './components/modals'
import AppRoutes from './Routes'
import { LegacyReduxSnapshotProvider } from './platform/adapters/LegacyReduxSnapshotProvider'
import { backendGateway } from './platform/adapters/LegacyBackendGateway'
import { createConfiguredFsmOrderSnapshotProvider } from './platform/adapters/FsmOrderSnapshotTransport'
import { createConfiguredFsmDriverSnapshotProvider } from './platform/adapters/FsmDriverSnapshotTransport'
import { platformInterface } from './platform/platform-interface'
import { driverMapGateway, DRIVER_MAP_EVENTS } from './platform/adapters/DriverMapGateway'
import './App.scss'

const legacySnapshotProvider = new LegacyReduxSnapshotProvider(store)
const serverOrderSnapshotProvider = createConfiguredFsmOrderSnapshotProvider()
backendGateway.setEventPublisher(event => platformInterface.runtime.publish(event))

const mapStateToProps = (state: IRootState) => ({
  configStatus: configSelectors.status(state),
  language: configSelectors.language(state),
  user: userSelectors.user(state),
  tokens: userSelectors.tokens(state),
})

const mapDispatchToProps = {
  initUser: userActionCreators.initUser,
}

const connector = connect(mapStateToProps, mapDispatchToProps)

interface IProps extends ConnectedProps<typeof connector> {
}

const App: React.FC<IProps> = ({
  configStatus,
  language,
  user,
  tokens,
  initUser,
}) => {
  useEffect(() => { applyUiDocumentLanguage(language?.iso, document.documentElement) }, [language?.iso])
  useEffect(() => driverMapGateway.subscribe(event => {
    if (event.type !== DRIVER_MAP_EVENTS.RecoveryChecked) return
    const payload = event.payload as { orderId: string }
    store.dispatch(refreshOrder(payload.orderId))
    store.dispatch(refreshActiveOrders())
    store.dispatch(refreshReadyOrders())
    // Query the selected provider as well: FSM views do not read legacy Redux.
    void platformInterface.runtime.refresh()
  }), [])
  useEffect(() => {
    driverMapGateway.setRecoveryIdentity(user?.u_role === EUserRoles.Driver ? user.u_id : null)
  }, [user?.u_id, user?.u_role, tokens?.token, tokens?.u_hash])
  useEffect(() => {
    if (!user?.u_id) return
    return subscribeOrderWake(() => {
      store.dispatch(refreshActiveOrders())
      if (user.u_role === EUserRoles.Driver) store.dispatch(refreshReadyOrders())
      store.getState().orders.orders.forEach((record, id) => {
        if (record.listeners > 0) store.dispatch(refreshOrder(id))
      })
    })
  }, [user?.u_id,user?.u_role])
  useEffect(() => subscribeSessionRevocation(() => {
    store.dispatch({ type: UserActionTypes.LOGOUT_START, payload: { externalRevocation: true } })
    store.dispatch(clearOrders())
    store.dispatch({ type: UserActionTypes.LOGOUT_SUCCESS })
  }), [])

  useEffect(() => { notifyNativeStartup((window as any).ReactNativeWebView) }, [])

  useEffect(() => {
    initUser()

    backendGateway.activateChatServer()
    const interval = setInterval(() => backendGateway.activateChatServer(), 30000)
    return () => {
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    const driverSnapshotProvider = user?.u_role === EUserRoles.Driver ?
      createConfiguredFsmDriverSnapshotProvider(user.u_id) :
      null
    recordPlatformProvider(driverSnapshotProvider ? 'fsm-driver' : serverOrderSnapshotProvider ? 'fsm-order' : 'legacy-redux')
    platformInterface.snapshotProvider
      .setProvider(
        driverSnapshotProvider ?? serverOrderSnapshotProvider ?? legacySnapshotProvider,
      )
      .catch(error => console.error('[PlatformInterface] Snapshot provider setup failed', error))
  }, [user?.u_id, user?.u_role])

  const getMetaTags = () => {
    let _domain = `${window.location.protocol}//${window.location.host}/`

    return (
      <Helmet>
        {SITE_CONSTANTS.OG_IMAGE && (
          <meta property="og:image" content={_domain + SITE_CONSTANTS.OG_IMAGE} />
        )}
        {SITE_CONSTANTS.TW_IMAGE && (
          <meta
            property="twitter:image"
            content={_domain + SITE_CONSTANTS.TW_IMAGE}
          />
        )}
        <style>{`
          .colored {
            color: ${SITE_CONSTANTS.PALETTE.primary.dark}
          }

          section details summary {
            color: ${SITE_CONSTANTS.PALETTE.primary.dark};
          }
          section details summary::after {
            border-top: 10px solid ${SITE_CONSTANTS.PALETTE.primary.main};
          }

          .modal .active {
            color: ${SITE_CONSTANTS.PALETTE.primary.dark}
          }
          .modal form fieldset h3, .modal form fieldset h4 {
            color: ${SITE_CONSTANTS.PALETTE.primary.dark}
          }

          .phone-link {
            border-bottom: 1px solid ${SITE_CONSTANTS.PALETTE.primary.light};
          }
          .phone-link:hover {
            border-bottom-color: ${SITE_CONSTANTS.PALETTE.primary.dark};
          }
        `}</style>
      </Helmet>
    )
  }

  return (
    <React.Fragment>
      <Theme>
        {getMetaTags()}
        <ConnectionBar authOnly/>
        <React.Fragment key={`routes-${language?.id || ''}-${language?.iso || ''}`}>
          <AppRoutes />
          <ModalHost languageIso={language?.iso} />
        </React.Fragment>
      </Theme>
    </React.Fragment>
  )
}

export default connector(App)
