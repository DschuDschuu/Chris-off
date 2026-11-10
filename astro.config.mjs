import { defineConfig } from 'astro/config';
import remarkTagebuch from './src/lib/remark-tagebuch.mjs';
import site from './site.config.mjs';

export default defineConfig({
  site: site.url,
  output: 'static',
  trailingSlash: 'always',
  markdown: { remarkPlugins: [remarkTagebuch] },
});
