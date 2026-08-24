<script lang="ts">
	import { page } from '$app/state';
	import Button from '$lib/components/shared/Button.svelte';
</script>

<div class="flex min-h-screen items-center justify-center px-4">
	<div class="text-center">
		<h1 class="text-6xl font-bold opacity-20">{page.status}</h1>
		<p class="mt-4 text-lg">{page.error?.message ?? 'Something went wrong'}</p>
		<Button href="/" variant="default" class="mt-6">Go home</Button>
	</div>
</div>
