import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
export default defineConfig({
 base: process.env.VITE_BASE ?? '/',
 resolve: { alias: { '@brainrun/i18n-jsx': new URL('./src/i18n-jsx', import.meta.url).pathname } },
 plugins: [react({ jsxImportSource: '@brainrun/i18n-jsx' })],
})
