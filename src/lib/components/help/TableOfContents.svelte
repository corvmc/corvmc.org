<script lang="ts">
	import type { Heading } from '$lib/utils/markdown';

	let { headings }: { headings: Heading[] } = $props();

	let activeId = $state('');

	$effect(() => {
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						activeId = entry.target.id;
					}
				}
			},
			{ rootMargin: '-80px 0px -60% 0px' }
		);

		for (const h of headings) {
			const el = document.getElementById(h.id);
			if (el) observer.observe(el);
		}

		return () => observer.disconnect();
	});
</script>

{#if headings.length > 0}
	<nav class="text-sm space-y-1">
		<p class="font-semibold text-subtle uppercase tracking-wide mb-2">On this page</p>
		{#each headings as heading (heading.id)}
			<a
				href="#{heading.id}"
				class="block py-0.5 transition-colors hover:text-primary {activeId === heading.id
					? 'text-primary font-medium'
					: 'opacity-70'}"
				style="padding-left: {(heading.level - 2) * 12}px"
			>
				{heading.text}
			</a>
		{/each}
	</nav>
{/if}
