import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { bootstrapAuthFromSessionStorage } from './api'
import App from './App'
import './styles.css'

bootstrapAuthFromSessionStorage()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
