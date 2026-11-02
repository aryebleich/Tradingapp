# Brightfolio for Android

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
