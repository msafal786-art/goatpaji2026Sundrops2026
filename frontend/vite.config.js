import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    proxy: { '/api': 'http://localhost:3001' }
  },
  preview: {
    proxy: { '/api': 'http://localhost:3001' }
  }
})
