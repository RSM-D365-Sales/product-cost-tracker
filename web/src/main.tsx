import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// First: takes any ?key=… off the URL before the router or embed check reads it.
import './lib/demoKey'
import '@fontsource/poppins/500.css'
import '@fontsource/poppins/600.css'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
