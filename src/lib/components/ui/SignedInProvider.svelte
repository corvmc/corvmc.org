<script lang="ts">
	import type { Snippet } from 'svelte';
	import { provideSignedIn } from './signed-in';

	/**
	 * A component of its own because the layouts that know the viewer `await`
	 * first, and context has to be set during a synchronous init.
	 */
	let { signedIn, children }: { signedIn: boolean; children: Snippet } = $props();
	provideSignedIn(() => signedIn);
</script>

{@render children()}
