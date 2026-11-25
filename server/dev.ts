// Lokaler API-Server für `npm run dev` (Vite leitet /api hierher weiter)
import app from './app.js'

const port = Number(process.env.API_PORT || 3001)
app.listen(port, () => console.log(`API läuft auf http://localhost:${port}/api`))
