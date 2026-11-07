import React from 'react'
import { connect, ConnectedProps } from 'react-redux'
import { IRootState } from '../../state'
import { configSelectors } from '../../state/config'
import { EStatuses, EUserRoles } from '../../types/types'
import { userSelectors } from '../../state/user'
import { driverMapGateway } from '../../platform/adapters/DriverMapGateway'
import DriverCommandRecoveryNotice from '../DriverCommandRecoveryNotice'
import Header from '../Header'
import './styles.scss'

const mapStateToProps = (state: IRootState) => ({
  configStatus: configSelectors.status(state),
  language: configSelectors.language(state),
  user: userSelectors.user(state),
})

const connector = connect(mapStateToProps)

interface IProps extends ConnectedProps<typeof connector> {}

function Layout({
  children,
  configStatus,
  language,
  user,
}: React.PropsWithChildren<IProps>) {
  return (
    <main className="layout" data-config-status={EStatuses[configStatus]}>
      <Header key={`${configStatus}-${language?.id || ''}-${language?.iso || ''}`} className="layout__header" />
      <DriverCommandRecoveryNotice controller={driverMapGateway.recovery} userId={user?.u_role===EUserRoles.Driver?user.u_id:undefined} iso={language?.iso}/>
      <div className="layout__content">{children}</div>
    </main>
  )
}

export default connector(Layout)
