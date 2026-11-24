<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import { getPressKitEditor } from '#lib/remote/press-kit.remote.js';
	import PressKitProgress from '#lib/components/band/PressKitProgress.svelte';
	import { getBandLayoutContext } from '../layout-context';
	import PressKitForm from './PressKitForm.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Button from '#lib/components/ui/Button.svelte';

	// Resolve here and hand the form plain props. The form must not live in a
	// component whose script awaits: a top-level await marks every later
	// declaration "blocked", turning each bind:value into an async derived — the
	// churn behind the effect_update_depth_exceeded crash on the profile editor.
	const bandLayout = getBandLayoutContext();
	const layout = $derived(bandLayout.current);
	// Above the await, and read from the resolved layout rather than
	// `page.params`: it is the ref the editor query guards on. A rename keeps the slug.
	// svelte-ignore state_referenced_locally
	const slug = layout.band.slug;
	const band = $derived(layout.band);
	// Derived so Kit's refresh after a save or an upload reaches the progress
	// bar and the photo list; the form below seeds itself once from its props.
	const editor = $derived(await getPressKitEditor(slug));
</script>

<PageHeader width="3xl" title={m.band_slug_press_kit_title()} subtitle={band.name} />
<PageContent width="3xl">
	<PressKitProgress
		slug={band.slug}
		sections={editor.progress.sections}
		done={editor.progress.done}
		total={editor.progress.total}
		next={editor.progress.next}
	/>
	<PressKitForm
		{band}
		epk={editor.epk}
		media={editor.media}
		photoLimit={editor.photoLimit}
		premium={editor.premium}
		canEdit={editor.canEdit}
	/>
	<!-- After the Save: the zip is built from what is saved, not from the form. -->
	{#if editor.canEdit}
		<InfoCard title={m.band_slug_press_kit_press_photos_download_kit_title()}>
			<p class="text-muted">
				{m.band_slug_press_kit_press_photos_zip_holding_one_page_press_text()}
			</p>
			<div>
				<Button href="/api/bands/{band.id}/press-kit.zip" variant="primary" size="sm">
					{m.band_slug_press_kit_press_photos_download_press_kit_zip_label()}
				</Button>
			</div>
		</InfoCard>
	{/if}
</PageContent>
