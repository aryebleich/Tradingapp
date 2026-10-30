# Brightfolio for Android

A Trusted Web Activity: the live Brightfolio site in a full-screen app with its own icon. Built and
published by `.github/workflows/android.yml`; the download button points to the latest build.

- `release.keystore` is created by the first build and kept here; its password is only in the
  `ANDROID_KEY_PASSWORD` repository secret. Keep that secret: without it, new versions cannot be
  signed with the same key and phones would have to uninstall the old app first.
- `cert-sha256.txt` is the signing certificate's fingerprint. The site serves it at
  `/.well-known/assetlinks.json`, which lets Android open the app without a browser address bar.
