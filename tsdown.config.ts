import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/startup.ts'],
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  dts: false,
  clean: true,
  fixedExtension: false,
  // commander (dependency) and every @deepseek-ai/* peer stay external: the
  // dsh runtime resolution supplies the peers so all plugins share the
  // installation's single instances.
})
