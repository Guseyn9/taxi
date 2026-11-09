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
