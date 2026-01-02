import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate', // Yeni versiyon gelince otomatik güncelle
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: 'Sera Akıllı Takip Sistemi',
        short_name: 'SeraTakip',
        description: 'IoT Tabanlı Sera İzleme ve Kontrol Paneli',
        theme_color: '#0a0a0a', // Telefonun üst bar rengi (React temanla uyumlu olsun)
        background_color: '#0a0a0a',
        display: 'standalone', // Tarayıcı çubuğunu gizle, tam ekran yap
        icons: [
          {
            src: '196.png', // pwa-192x192.png yerine gezgindeki isim
            sizes: '196x196',
            type: 'image/png'
          },
          {
            src: '512.png', // pwa-512x512.png yerine gezgindeki isim
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: '512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ]
})