# Booking submission error contrast

The shared error token (#b42318) was intended for light surfaces. The submission error inherited it on the wine booking sheet (#8d1c22), giving only 1.38:1 contrast. The Valentin acceptance fixture also omitted mobile-journey.css, hiding the production cascade from visual acceptance.

The error now has an opaque porcelain surface and dark text in both the booking sheet and price dialog. Recovery actions have wine text and borders, a minimum 44px target, wrapping labels, hover feedback, and a visible keyboard focus outline. The price dialog uses the same error container. No request handler, endpoint, payload, unknown-result guard, or refresh behavior changed.

Validation:
- Browser reproduction before the fix: computed #b42318 text on #8d1c22.
- After: message #101010 on #fffaf7, 18.37:1; recovery text/border #8d1c22 on #fffaf7, 8.73:1; hover on #fff0eb, 8.15:1.
- 320px and 390px mobile widths: no horizontal overflow; recovery target 44px high.
- Desktop 1280px: server refusal in price dialog keeps entered amount and readable recovery action.
- Unknown-result recovery increments only the local read counter; submit count stays zero and direct creation commands remain disabled.
- Recovery keyboard focus: solid 2px wine outline with 2px offset.
- 237 Jest suites / 1354 tests passed; scoped ESLint and TypeScript passed; design boundary check passed (268 files / 71 handlers).
- Fixture now includes production journey CSS and adjacent CSS imports in production order; local network calls remain blocked by CSP.

These are frontend and synthetic error-state checks, not backend ride acceptance.

## Debug menu and unexpected driver controls

User screenshots showed that the public-build gate hid log exports and both role-specific emulator panels. Restore the existing menu entry points in production builds. Graph/test-position controls remain restricted to local development. Opening an emulator does not start it. Existing runtime isolation and disposable-account checks remain unchanged: server emulation is not configured on the Vercel build and cannot be claimed as accepted or functional there. The panel now explains this in Russian/French/Arabic/English and links to the existing local demo.

Move ActiveVehiclePicker from the main driver page into the driver profile. Preserve its selection, activation and refresh actions. Give the selector component its own stylesheet and localized fallback copy, so it renders consistently inside the profile regardless of route. The compact order refresh failure notice still reports a real backend read failure; this patch does not suppress it.

Additional acceptance on a production-mode network-disabled fixture:
- Client menu: driver emulator, interface/flow/all logs visible.
- Driver menu: client emulator, flow/raw/decision/all logs visible.
- Both emulator dialogs open and close; start/check remain disabled without the isolated runtime. No order or emulator request was sent.
- Vehicle profile on 320px: Russian labels, no horizontal overflow, minimum touch target above 44px.
- 237 suites / 1354 tests, TypeScript, scoped ESLint and boundary check passed after these changes.
