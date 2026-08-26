<script lang="ts">
	import type { Snippet } from 'svelte';

	let { main, side }: { main: Snippet; side: Snippet } = $props();
</script>

<div class="profile-grid">
	<div class="profile-grid__col">{@render main()}</div>
	<div class="profile-grid__col">{@render side()}</div>
</div>

<style>
	.profile-grid {
		display: grid;
		grid-template-columns: 1.6fr 1fr;
		gap: 20px;
		align-items: start;
	}
	.profile-grid__col {
		display: flex;
		flex-direction: column;
		gap: 16px;
		min-width: 0;
	}
	@media (max-width: 720px) {
		.profile-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
