<script lang="ts">
	import { IconSearch } from '@tabler/icons-svelte';

	let {
		onselect
	}: {
		onselect: (slug: string) => void;
	} = $props();

	let query = $state('');
	import type { HelpArticle } from '$lib/server/db/schema';

	let results = $state<Pick<HelpArticle, 'id' | 'title' | 'slug' | 'summary'>[]>([]);
	let open = $state(false);
	let debounceTimer: ReturnType<typeof setTimeout>;

	function handleInput() {
		clearTimeout(debounceTimer);
		if (query.trim().length < 2) {
			results = [];
			open = false;
			return;
		}
		debounceTimer = setTimeout(async () => {
			const res = await fetch(`/api/help/search?q=${encodeURIComponent(query.trim())}`);
			if (res.ok) {
				const json: { results: typeof results } = await res.json();
				results = json.results;
				open = results.length > 0;
			}
		}, 300);
	}

	function select(slug: string) {
		open = false;
		query = '';
		results = [];
		onselect(slug);
	}
</script>

<div class="relative w-full max-w-md">
	<div class="relative">
		<IconSearch size={16} class="absolute top-1/2 left-3 -translate-y-1/2 opacity-50" />
		<input
			type="text"
			placeholder="Search help articles..."
			class="input w-full pl-9"
			bind:value={query}
			oninput={handleInput}
			onfocus={() => {
				if (results.length > 0) open = true;
			}}
			onblur={() => {
				setTimeout(() => {
					open = false;
				}, 200);
			}}
		/>
	</div>

	{#if open}
		<div
			class="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-box border border-base-300 bg-base-100 shadow-lg"
		>
			{#each results as result (result.slug)}
				<button
					type="button"
					class="w-full px-4 py-2 text-left transition-colors hover:bg-base-200"
					onmousedown={() => select(result.slug)}
				>
					<p class="text-sm font-medium">{result.title}</p>
					{#if result.summary}
						<p class="truncate text-subtle">{result.summary}</p>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>
