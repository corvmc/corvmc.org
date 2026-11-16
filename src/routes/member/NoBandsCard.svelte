<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { many } from '#lib/terms.js';
	import { resolve } from '$app/paths';

	/** Shown only while the member is in no band; joining one removes it. */
	let { bandCount }: { bandCount: number } = $props();
</script>

{#if bandCount === 0}
	<InfoCard title={many(m.term_band)} testid="no-bands">
		<p class="text-muted">{m.member_bands_re_not_any_bands_yet_body()}</p>
		<div class="mt-3 flex flex-wrap gap-2">
			<!-- A full reload, as the sidebar's link does: the bands page opens its modal on arrival. -->
			<Button
				href={resolve('member/bands?create=1')}
				variant="primary"
				size="sm"
				data-sveltekit-reload>{m.member_bands_create_band_label()}</Button
			>
			<Button href={resolve('member/directory/bands')} variant="default" size="sm"
				>{m.member_browse_bands_label({ bands: m.term_band({ count: 2 }) })}</Button
			>
		</div>
	</InfoCard>
{/if}
