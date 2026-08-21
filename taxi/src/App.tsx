import React, { useEffect } from 'react'
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
import './App.scss'

const legacySnapshotProvider = new LegacyReduxSnapshotProvider(store)
const serverOrderSnapshotProvider = createConfiguredFsmOrderSnapshotProvider()
backendGateway.setEventPublisher(event => platformInterface.runtime.publish(event))

const mapStateToProps = (state: IRootState) => ({
  configStatus: configSelectors.status(state),
  language: configSelectors.language(state),
  user: userSelectors.user(state),
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
  initUser,
}) => {
  if ((window as any).ReactNativeWebView) {
    (window as any).ReactNativeWebView.postMessage(
      JSON.stringify({ type: 'SYSTEM', message: 'START' }),
    )
  }

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
        <React.Fragment key={`routes-${language?.id || ''}-${language?.iso || ''}`}>
          <AppRoutes />
          <ModalHost languageIso={language?.iso} />
        </React.Fragment>
      </Theme>
    </React.Fragment>
  )
}

export default connector(App)
