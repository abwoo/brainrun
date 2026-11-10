import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 部署基路径：本地开发/预览用 '/'；GitHub Pages 用 VITE_BASE=/brainrun/
// （仓库已公开并启用 Pages，站地址 https://abwoo.github.io/brainrun/；
//  Actions 部署流程在 Phase 3 之后再接，这里只让应用认识子路径）。
// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
})
