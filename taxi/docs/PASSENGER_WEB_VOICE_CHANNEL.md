# Passenger Web Voice Channel

## Purpose

Add a voice modality directly to the existing Passenger Web screen. The map and the normal booking form remain visible and usable. Voice only fills the same pickup/destination fields and requests submission through the existing form.

## Runtime path

1. Browser microphone input is converted into the Interaction Action `voice.transcript.received`.
2. `BrowserVoiceChannel` dispatches that action through the existing `PlatformInterfaceRuntime`. It contains no taxi or booking rules.
3. `PassengerVoiceAssistant` owns the passenger dialogue: pickup, destination, explicit confirmation.
4. Address text is resolved by the existing `passengerGateway.geocode`; current location uses the existing `isCurrent` point flow.
5. The existing Redux point actions run the same geofence checks as manual input.
6. Voice confirmation invokes the existing `VotingForm.submit('order')` callback. It does not call the backend directly.
7. The form remains authoritative for authentication, phone validation, coverage checks, pricing, and order creation.

## Safety and consistency

- No order is submitted before an explicit voice confirmation.
- A failed validation or backend submission leaves the dialogue at the confirmation step; the passenger can correct the form on screen and retry.
- Voice and manual input share the same Redux-backed pickup and destination values.
- Stopping voice does not cancel or mutate an existing order.
- Unsupported speech recognition leaves the regular web booking flow unaffected.

## Initial language support

The browser recognition locale follows the passenger UI language: Russian, French, Moroccan Arabic, English, and Spanish. Browser support depends on the device and browser implementation of the Web Speech API. The map and form remain the fallback interaction.

## Out of scope for this first integration

- Background or always-on microphone access.
- Phone-call ordering.
- Voice-only booking without the web screen.
- Replacing the Voice Assistant scenario engine or changing Taxi backend/FSM logic.
- Automatic tariff selection or price negotiation by voice.
