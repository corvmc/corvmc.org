<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
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
	<nav class="space-y-1 text-sm">
		<p class="mb-2 text-subtle font-semibold tracking-wide uppercase">
			{m.help_table_of_contents_page()}
		</p>
		{#each headings as heading (heading.id)}
			<a
				href="#{heading.id}"
				class="block py-0.5 transition-colors hover:text-primary {activeId === heading.id
					? 'font-medium text-primary'
					: 'opacity-70'}"
				style="padding-left: {(heading.level - 2) * 12}px"
			>
				{heading.text}
			</a>
		{/each}
	</nav>
{/if}
