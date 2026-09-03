<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import { getPressKitEditor } from '$lib/remote/press-kit.remote';
	import PressKitProgress from '$lib/components/band/PressKitProgress.svelte';
	import { getBandLayoutContext } from '../layout-context';
	import PressKitForm from './PressKitForm.svelte';
	import PressPhotos from './PressPhotos.svelte';

	// Resolve here and hand the form plain props. The form must not live in a
	// component whose script awaits: a top-level await marks every later
	// declaration "blocked", turning each bind:value into an async derived — the
	// churn behind the effect_update_depth_exceeded crash on the profile editor.
	const bandLayout = getBandLayoutContext();
	const layout = $derived(bandLayout.current);
	// Above the await, and read from the resolved layout rather than
	// `page.params`: it is the ref the editor query guards on.
	const band = layout.band;
	const editor = await getPressKitEditor(band.slug);
</script>

<PageHeader title="Press Kit" subtitle={band.name} />
<PageContent width="3xl">
	<PressKitProgress
		slug={band.slug}
		sections={editor.progress.sections}
		done={editor.progress.done}
		total={editor.progress.total}
		next={editor.progress.next}
	/>
	<PressKitForm {band} epk={editor.epk} />
	<PressPhotos {band} media={editor.media} photoLimit={editor.photoLimit} />
</PageContent>
