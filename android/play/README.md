# Publishing Brightolio on Google Play

Once the app is on Google Play, people install it like any other app (no "unknown sources" step) and it updates itself. The Android workflow already builds the Play file (`brightfolio.aab`) on every run; these are the one-time steps only the owner can do.

1. **Developer account.** Sign up at https://play.google.com/console (one-time $25 fee, identity check). New personal accounts must run a closed test with at least 12 testers for 14 days before the app can go to production; an organization account (with a D-U-N-S number) skips that.
2. **Keep one signing key.** Add the repository secret `ANDROID_KEY_PASSWORD` (any long password) if it is not there yet, and run the "Android app" workflow once. That key is the Play *upload key*; let Google manage the app signing key (Play App Signing, the default).
3. **Create the app** in Play Console: name "Brightolio", package `com.brightfolio.app`, free. Fill in:
   - Store listing: the texts in `listing/en-US/`, the icon (`public/icon-512.png`), screenshots (`node scripts/shots-alpaca.mjs` makes phone screenshots), a feature graphic (1024×500).
   - Privacy policy URL: your site's `/privacy.html`.
   - App content: Data safety (account email, financial info, app activity; encrypted in transit; users can ask for deletion in Settings), content rating, target audience 18+, and the **Financial features** declaration (stock trading through third-party brokers; Brightolio is not the broker).
4. **First upload by hand.** Download `brightfolio.aab` from the "android-latest" GitHub release and upload it to the Internal testing track (Google requires the first upload in the Console).
5. **Automatic uploads.** In Google Cloud, create a service account, give it access in Play Console → Users and permissions (Release apps), make a JSON key, and save the whole JSON as the repository secret `PLAY_SERVICE_ACCOUNT_JSON`. From then on every build is uploaded to the track in the repository variable `PLAY_TRACK` (`internal` by default; use `production` when you are ready). Release notes come from `whatsnew/whatsnew-en-US`.
6. **Show the Play button on the site.** When the app is live, set `ANDROID_PLAY=1` in Render (or `ANDROID_PLAY_URL` to the exact listing address). The site's Android page then shows "Get it on Google Play" instead of the file download.
7. **Sign-in links.** Play re-signs the app with Google's key. Copy the "App signing key certificate" SHA-256 from Play Console → Test and release → App integrity, and set `ANDROID_CERT_SHA256` in Render to `<that fingerprint>,<the one in android/cert-sha256.txt>`, so links from the site open the app for both the Play and the downloaded versions.
