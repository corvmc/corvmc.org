<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import ClubList from './ClubList.svelte';
</script>

<PageHeader title={m.staff_clubs_title()} />

<PageContent>
	<ClubList />
</PageContent>
