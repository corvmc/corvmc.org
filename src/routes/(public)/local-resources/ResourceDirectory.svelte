<script lang="ts">
	import Tile from '$lib/components/public/Tile.svelte';
	import { IconMapPin, IconPhone, IconWorld } from '@tabler/icons-svelte';
	import { getLocalResourceDirectory } from '$lib/remote/local-resources.remote';

	/**
	 * The published directory, grouped by category. Renders nothing when empty,
	 * so the page falls back to its tip form alone.
	 */
	const groups = $derived(await getLocalResourceDirectory());

	function host(url: string) {
		try {
			return new URL(url).host.replace(/^www\./, '');
		} catch {
			return url;
		}
	}
</script>

{#if groups.length > 0}
	<section class="px-6 py-12">
		<div class="mx-auto flex max-w-4xl flex-col gap-10">
			{#each groups as group (group.id)}
				<div>
					<h2 class="mb-4 text-2xl font-bold tracking-tight">{group.name}</h2>
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
						{#each group.resources as r (r.id)}
							<Tile fill="raised" align="stack">
								<h3 class="text-lg font-bold">{r.name}</h3>
								{#if r.description}
									<p class="leading-relaxed text-fg-2">{r.description}</p>
								{/if}
								<ul class="flex flex-col gap-1 text-sm">
									{#if r.addressLine}
										<li class="flex items-center gap-2">
											<IconMapPin size={16} aria-hidden="true" />{r.addressLine}
										</li>
									{/if}
									{#if r.phone}
										<li class="flex items-center gap-2">
											<IconPhone size={16} aria-hidden="true" />
											<a class="link" href="tel:{r.phone}">{r.phone}</a>
										</li>
									{/if}
									{#if r.website}
										<li class="flex items-center gap-2">
											<IconWorld size={16} aria-hidden="true" />
											<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an outside site -->
											<a class="link" href={r.website} target="_blank" rel="noopener noreferrer"
												>{host(r.website)}</a
											>
										</li>
									{/if}
								</ul>
							</Tile>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	</section>
{/if}
