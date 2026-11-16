<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import CommitteeList from './CommitteeList.svelte';
</script>

<PageHeader title={m.staff_committees_title()} />

<PageContent>
	<CommitteeList />
</PageContent>
