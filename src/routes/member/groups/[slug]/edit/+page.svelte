<script lang="ts">
	import { page } from '$app/state';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import { getGroupEditor } from '$lib/remote/groups.remote';
	import GroupProfileForm from './GroupProfileForm.svelte';

	// Resolved here and handed to the form as plain props. A top-level await
	// marks every later declaration async-gated, which would compile each
	// `fields.X.as()` in the form's template into an async derived — the churn
	// behind JAVASCRIPT-SVELTEKIT-W. Pinned by `src/async-effect-shape.spec.ts`.
	const slug = page.params.slug!;
	const group = await getGroupEditor(slug);
</script>

<PageHeader
	title="Edit {group.kind === 'committee' ? 'committee' : 'club'}"
	subtitle={group.name}
/>
<PageContent width="3xl">
	<GroupProfileForm {group} />
</PageContent>
