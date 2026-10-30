// Generates the Android app project (a Trusted Web Activity: the Brightfolio site in a full-screen
// Chrome window, with the app icon, splash screen and notifications). The site itself loads live,
// so every push to the site shows in the app at once; this project changes only for a new icon,
// name or package. Used by .github/workflows/android.yml.
const path = require('path');
const { TwaManifest, TwaGenerator, ConsoleLog } = require('@bubblewrap/core');

const host = (process.env.APP_HOST || 'quantpocket.onrender.com').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const versionCode = +process.env.VERSION_CODE || 1;
const manifest = new TwaManifest({
  packageId: 'com.brightfolio.app',
  host,
  name: 'Brightfolio',
  launcherName: 'Brightfolio',
  display: 'standalone',
  themeColor: '#1d4ed8',
  themeColorDark: '#0b1324',
  navigationColor: '#ffffff',
  navigationColorDark: '#0b1324',
  navigationDividerColor: '#e2e8f0',
  navigationDividerColorDark: '#0b1324',
  backgroundColor: '#ffffff',
  enableNotifications: true,
  startUrl: '/app',
  iconUrl: `https://${host}/icon-512.png`,
  maskableIconUrl: `https://${host}/icon-512.png`,
  splashScreenFadeOutDuration: 300,
  signingKey: { path: path.resolve(__dirname, 'release.keystore'), alias: 'brightfolio' },
  appVersionName: `1.${versionCode}`,
  appVersion: `1.${versionCode}`,
  appVersionCode: versionCode,
  shortcuts: [],
  generatorApp: 'bubblewrap-cli',
  webManifestUrl: `https://${host}/manifest.webmanifest`,
  fallbackType: 'customtabs',
  features: {},
  enableSiteSettingsShortcut: true,
  isChromeOSOnly: false,
  isMetaQuest: false,
  orientation: 'default',
  fingerprints: [],
  minSdkVersion: 24, // Android 7.0 and newer (what the browser helper library needs)
});
new TwaGenerator().createTwaProject(path.resolve(__dirname, 'project'), manifest, new ConsoleLog('android'))
  .then(() => console.log('Android project generated for', host, 'version', versionCode))
  .catch(e => { console.error(e); process.exit(1); });
