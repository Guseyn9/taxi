import axios from 'axios'
import { LEGACY_HTTP_TIMEOUT_MS } from './httpPolicy'
test('legacy HTTP operations have a finite application deadline',()=>{
 expect(axios.defaults.timeout).toBe(LEGACY_HTTP_TIMEOUT_MS)
 expect(LEGACY_HTTP_TIMEOUT_MS).toBeGreaterThan(0)
 expect(LEGACY_HTTP_TIMEOUT_MS).toBeLessThanOrEqual(15000)
})
