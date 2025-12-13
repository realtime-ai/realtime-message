import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Note: StrictMode is disabled to prevent double WebSocket connections in dev mode
createRoot(document.getElementById('root')!).render(<App />)
