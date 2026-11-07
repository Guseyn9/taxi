Taxi Morocco — frontend remediation, 7 November 2026

Source snapshot includes the existing local frontend fixes plus the new diagnostic, GPS, dependency and gruzvill build corrections.
No backend source or database modifications.

Use Node 24, then:
  cd taxi
  npm ci
  npm test -- --runInBand
  npm run typecheck
  npm run lint -- --quiet
  npm run build:gruzvill

The gruzvill build pins API and dictionary to https://ibronevik.itest24.com/taxi_dev2.
No shared FSM credential is bundled. OAuth stays disabled until server state support is accepted.
Standalone emulator accounts/config, auth state, environment files and runtime reports are excluded.
Previously exposed credentials still require revocation by their owner.
Private-file ACL, boarding PIN authority, fare settlement and physical-device/shared-backend acceptance require backend access.
See public/release-info.json and docs/FRONTEND_REMEDIATION_20261107.md for scope and validation.
