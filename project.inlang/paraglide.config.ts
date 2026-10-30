import { defineConfig } from '@inlang/paraglide-js';

// Read by both the vite plugin and `paraglide-js compile` (the `prepare` and
// `check` scripts), so the two cannot disagree. English only: `baseLocale`
// alone means no cookie, no URL prefix and no reroute — a message is a constant.
export default defineConfig({
	outdir: './src/lib/paraglide',
	strategy: ['baseLocale'],
	emitReadme: false
});
