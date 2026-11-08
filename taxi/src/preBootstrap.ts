import { resetStaleAppCache } from './appCache'
import { captureAuthCallback } from './security/authCallback'
import { clearUnownedPrivateStorage } from './security/sessionLifecycle'

captureAuthCallback()
clearUnownedPrivateStorage()
try { localStorage.removeItem('gruzvill_client_order_emulator_accounts_v2') } catch { /* Storage may be blocked. */ }
resetStaleAppCache()
