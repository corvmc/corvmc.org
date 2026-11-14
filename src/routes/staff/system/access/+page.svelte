<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import AccessTab from './AccessTab.svelte';
</script>

<PageHeader width="full" title={m.staff_settings_access_title()} />

<PageContent width="full">
	<div class="space-y-4">
		<AccessTab />
	</div>
</PageContent>
