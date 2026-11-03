import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: 'esnext',
    minify: 'terser',
    terserOptions: {
      compress: {
        passes: 3,
        pure_getters: true,
        unsafe: true,
        unsafe_math: true,
      },
      mangle: {
        toplevel: true,
      },
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('react-dom-client') || id.includes('react-dom/client')) {
            return 'vendor-react-dom-client'
          }
          if (id.includes('node_modules/react-dom/')) {
            return 'vendor-react-dom'
          }
          if (id.includes('node_modules/react/') || id.includes('node_modules/scheduler/')) {
            return 'vendor-react'
          }
          if (
            id.includes('node_modules/react-router-dom/') ||
            id.includes('node_modules/react-router/') ||
            id.includes('node_modules/@remix-run/router/')
          ) {
            return 'vendor-router'
          }
          if (id.includes('@supabase/realtime-js') || id.includes('@supabase/phoenix')) {
            return 'vendor-supabase-realtime'
          }
          if (id.includes('@supabase/postgrest-js')) {
            return 'vendor-supabase-postgrest'
          }
          if (id.includes('@supabase/storage-js')) {
            return 'vendor-supabase-storage'
          }
          if (id.includes('@supabase/functions-js')) {
            return 'vendor-supabase-functions'
          }
        },
      },
    },
  },
})
