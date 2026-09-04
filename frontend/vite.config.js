import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // MarsaBot occupe 5174 et laisse 5173 a MarsaTrack, pour que les deux
  // frontends du projet puissent tourner en meme temps. strictPort empeche
  // Vite de glisser silencieusement sur un autre port si 5174 est pris : mieux
  // vaut un echec visible qu'une origine inattendue refusee par le CORS du
  // backend.
  const port = Number.parseInt(env.FRONTEND_PORT, 10) || 5174

  return {
    plugins: [react()],
    server: {
      port,
      strictPort: true,
    },
    preview: {
      port,
      strictPort: true,
    },
  }
})
