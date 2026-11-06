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
	import { m } from '#lib/paraglide/messages.js';
	import { browser } from '$app/env';
	import type { Snippet } from 'svelte';
	import { setContext } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { reportError } from '#lib/report-error.js';
	import { errorMessage } from '#lib/error-message.js';
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

	function handleError(err: unknown) {
		// Single client-side sink: forward genuine errors to Sentry (filtered) and
		// surface a toast. Covers both boundary-caught render/async errors and
		// errors handed up by child components (e.g. the Form component's catch).
		reportError(err);
		toast.error(errorMessage(err));
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
{#snippet failedAlert(error: unknown, reset: () => void)}
	<div class="contents" data-boundary-failed>
		<Alert type="error" {reset}>{m.ui_load_failed({ error: errorMessage(error) })}</Alert>
	</div>
{/snippet}

<!--
	`failed` is client-only: on the server, a boundary with one keeps the error, and
	a missing band would render this alert inside the layout. Without one the error
	reaches SvelteKit's own boundary, so the document is +error.svelte with its status.
-->
<svelte:boundary
	onerror={handleError}
	pending={showPending ? (pendingSnippet ?? defaultPending) : undefined}
	failed={browser ? failedAlert : undefined}
>
	{@render children()}
</svelte:boundary>
