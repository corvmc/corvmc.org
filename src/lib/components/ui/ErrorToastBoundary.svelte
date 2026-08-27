<script lang="ts" module>
	import { getContext, hasContext } from 'svelte';

	const ERROR_BOUNDARY_KEY = Symbol('error-toast-boundary');

	export interface ErrorBoundaryContext {
		reportError(err: unknown): void;
	}

	export function getErrorBoundary(): ErrorBoundaryContext | null {
		if (!hasContext(ERROR_BOUNDARY_KEY)) return null;
		return getContext<ErrorBoundaryContext>(ERROR_BOUNDARY_KEY);
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { setContext } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { reportError } from '$lib/report-error';
	import Alert from './Alert.svelte';

	let {
		children,
		pending: pendingSnippet,
		showPending = true
	}: {
		children: Snippet;
		pending?: Snippet;
		/**
		 * Whether to show placeholder UI while the boundary's `await` expressions first
		 * resolve. A boundary with a pending snippet renders that snippet during SSR
		 * *instead of* awaiting its contents, so pass `false` anywhere the server-rendered
		 * HTML needs to contain the real content (crawlable public pages).
		 */
		showPending?: boolean;
	} = $props();

	function extractMessage(err: unknown): string {
		if (err instanceof Error) return err.message;
		if (typeof err === 'string') return err;
		// Remote function rejections arrive as plain objects, e.g.
		// { body: { message: 'Internal Error' }, status: 500 }.
		if (err && typeof err === 'object') {
			const e = err as { message?: unknown; body?: { message?: unknown } };
			if (typeof e.body?.message === 'string') return e.body.message;
			if (typeof e.message === 'string') return e.message;
		}
		return 'Something went wrong';
	}

	function handleError(err: unknown) {
		// Single client-side sink: forward genuine errors to Sentry (filtered) and
		// surface a toast. Covers both boundary-caught render/async errors and
		// errors handed up by child components (e.g. the Form component's catch).
		reportError(err);
		toast.error(extractMessage(err));
	}

	setContext(ERROR_BOUNDARY_KEY, {
		reportError: handleError
	} satisfies ErrorBoundaryContext);
</script>

{#snippet defaultPending()}
	<div class="flex items-center justify-center p-12">
		<span class="loading loading-lg loading-spinner"></span>
	</div>
{/snippet}

<!--
	`pending` is passed as an attribute rather than declared as a snippet so it can be
	`undefined`: Svelte only substitutes the pending UI for the boundary's contents when
	the attribute resolves to something, and otherwise awaits and renders the real content.
-->
<svelte:boundary
	onerror={handleError}
	pending={showPending ? (pendingSnippet ?? defaultPending) : undefined}
>
	{@render children()}

	{#snippet failed(error, reset)}
		<Alert type="error" {reset}>Failed to load: {extractMessage(error)}</Alert>
	{/snippet}
</svelte:boundary>
