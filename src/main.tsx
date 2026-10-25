import { createRoot } from 'react-dom/client'
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import './index.css'
import App from './App'
import InstallBanner from './InstallBanner'
import { initNative, isNative } from './lib/native'

// Confirm the native JS bundle started, so Capgo can roll back a broken update.
if (isNative) {
  void CapacitorUpdater.notifyAppReady().catch(() => {
    // Keep updater failures out of the user interface; the app should still open.
  })
}
void initNative()
createRoot(document.getElementById('root')!).render(<><App /><InstallBanner /></>)
// Android app serves bundled assets; the service worker is for the web version only.
if ('serviceWorker' in navigator && import.meta.env.PROD && !isNative) addEventListener('load', () => navigator.serviceWorker.register('/sw.js'))
