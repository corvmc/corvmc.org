import { createRequire, register } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Plugin } from 'vite';

/**
 * Lets `vite preview` load a server build that imports `cloudflare:workers`:
 * adapter-cloudflare 8 rewrites its Node stub back to the bare specifier in
 * `.svelte-kit/output/server`, which preview then imports with Node's own loader
 * (sveltejs/kit#17271; upstream's answer is "run the build in workerd"). This
 * resolves the specifier to that same stub, which reads the bindings the
 * adapter's preview hook puts on `globalThis`. The deployed Worker never runs it.
 */
export function previewCloudflareWorkers(): Plugin {
	return {
		name: 'corvmc:preview-cloudflare-workers',
		configurePreviewServer: {
			order: 'pre',
			handler() {
				const adapter = createRequire(import.meta.url).resolve(
					'@sveltejs/adapter-cloudflare/package.json'
				);
				const stub = pathToFileURL(join(dirname(adapter), 'src/virtual-cloudflare-workers.js'));
				const hook = `export async function resolve(specifier, context, next) {
	if (specifier === 'cloudflare:workers') return { url: ${JSON.stringify(stub.href)}, shortCircuit: true };
	return next(specifier, context);
}`;
				register(`data:text/javascript,${encodeURIComponent(hook)}`);
			}
		}
	};
}
