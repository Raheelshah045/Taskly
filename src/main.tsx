import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import InstallBanner from './InstallBanner'
import { initNative, isNative } from './lib/native'
void initNative()
createRoot(document.getElementById('root')!).render(<><App /><InstallBanner /></>)
// Android app serves bundled assets; the service worker is for the web version only.
if ('serviceWorker' in navigator && import.meta.env.PROD && !isNative) addEventListener('load', () => navigator.serviceWorker.register('/sw.js'))
