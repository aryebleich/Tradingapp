# Brightolio for Android

A native Android app (Kotlin, Jetpack Compose), built and published by
`.github/workflows/android.yml`; the download button points to the latest build.

- Its own screens: Home (portfolio, today's change, positions), Trade (quote, buy/sell in dollars or
  shares, market or limit, review before sending), Orders, Watchlist and More. Everything else opens
  the website in a browser tab inside the app.
- Sign-in: email and password in the app, or Google / GitHub / phone code in the browser, which
  hands the app a one-time code (`/api/auth/app-handoff` → `brightfolio://signin`). The session
  token is stored encrypted with a key in the Android Keystore.
- The site address is the `APP_URL` repository variable (built in as `BuildConfig.BASE_URL`).
- `release.keystore` is created by the first build and kept here; its password is only in the
  `ANDROID_KEY_PASSWORD` repository secret. Keep that secret: without it, new versions cannot be
  signed with the same key and phones would have to uninstall the old app first.
- `cert-sha256.txt` is the signing certificate's fingerprint (served at
  `/.well-known/assetlinks.json`).
- Google Play: every build also makes `brightfolio.aab` (signed with the same key, used as the Play
  upload key). With the `PLAY_SERVICE_ACCOUNT_JSON` secret it is uploaded to Play automatically;
  the one-time owner steps are in `play/README.md`. With Play App Signing, add Google's app-signing
  certificate SHA-256 (Play Console → App integrity) to `ANDROID_CERT_SHA256` in Render, next to
  this key's, comma-separated, so sign-in links keep opening the app.
