import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ProgramOut from './ProgramOut'

// The About dialog's data file ships a version baked at sync time; this is the
// one the build actually produced. Spread, not assign: about-data.js may not
// have run yet, and it merges rather than overwriting. See public/about.js.
window.STOATWORKS_ABOUT = { ...window.STOATWORKS_ABOUT, version: __APP_VERSION__ }

const isProgramOut = new URLSearchParams(window.location.search).get('mode') === 'program-out'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isProgramOut ? <ProgramOut /> : <App />}</StrictMode>
)
