<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { page } from '$app/state';
	import Button from '$lib/components/ui/Button.svelte';
</script>

<div class="flex min-h-screen items-center justify-center px-4">
	<div class="text-center">
		<h1 class="text-6xl font-bold opacity-20">{page.status}</h1>
		<p class="mt-4 text-lg">{page.error?.message ?? m.public_error_something_went_wrong()}</p>
		<Button href="/" variant="default" class="mt-6">{m.public_error_go_home()}</Button>
	</div>
</div>
