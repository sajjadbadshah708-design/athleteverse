# AthleteVerse Sprint-0 Expo connectivity smoke test

This is a **standalone** Expo SDK 58 React Native application. It is deliberately outside the root npm workspaces and does not change the existing package-lock.json. It checks the versioned `GET /api/v1/health` endpoint on a real Android/iOS phone with a retry button. It does **not** implement the deferred player/staff mobile screens.

1. Use Node >=22.22, npm 10+, a running AthleteVerse API, and a phone with a compatible Expo Go or development build.
2. From `spikes/expo-health`, copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_URL` to the API origin (no `/api/v1`). Use a reachable network address; `localhost` on a phone points to the phone itself.
3. Run `npm install` and `npx expo start`; scan the QR code with the Expo app. Run `npx expo install --check` to check package compatibility.
4. Test on one Android phone and Expo Go or an eligible iOS device. A successful API response verifies connectivity only, not complete mobile features.

The app was not built or run in the source-editing environment because the Expo dependencies could not be downloaded. Install, build and test on real devices before claiming mobile smoke-test acceptance.
