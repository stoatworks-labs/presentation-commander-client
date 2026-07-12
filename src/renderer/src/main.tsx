import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ProgramOut from './ProgramOut'

const isProgramOut = new URLSearchParams(window.location.search).get('mode') === 'program-out'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isProgramOut ? <ProgramOut /> : <App />}</StrictMode>
)
