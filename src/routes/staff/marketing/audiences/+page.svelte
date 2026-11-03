<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getAudiences } from '$lib/remote/marketing.remote';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import { CreateAudienceAction } from '$lib/components/actions';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Pagination from '$lib/components/ui/Pagination.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import { formatDateShortYear } from '$lib/utils/format';

	let audiences = $derived(await getAudiences());
</script>

<PageHeader title={m.staff_audiences()} subtitle={m.staff_marketing()}>
	<CreateAudienceAction
		onsuccess={(result) => {
			const r = result as { audienceId?: string };
			if (r?.audienceId) goto(resolve(`/staff/marketing/audiences/${r.audienceId}`));
		}}
	/>
</PageHeader>
<PageContent>
	{#if audiences.length === 0}
		<EmptyState description={m.staff_marketing_audiences_description()} />
	{:else}
		<Table>
			{#snippet head()}
				<th>{m.staff_audience()}</th>
				<th class="col-support w-px">{m.staff_opt()}</th>
				<th class="cell-num">{m.staff_subscribers()}</th>
				<th class="col-extra whitespace-nowrap">{m.staff_created()}</th>
			{/snippet}
			{#each audiences as a (a.id)}
				{@const href = resolve(`/staff/marketing/audiences/${a.id}`)}
				<tr class="hover cursor-pointer" use:rowLink={href}>
					<td class="cell-primary"><EntityIdentity ref={a.ref} /></td>
					<td class="col-support w-px">
						{#if a.systemKey}
							<Badge size="sm" variant="info" class="whitespace-nowrap">{m.staff_built()}</Badge>
						{:else}
							<Badge size="sm" variant={a.allowOptIn ? 'success' : 'ghost'}>
								{a.allowOptIn ? m.staff_public() : m.staff_staff_only()}
							</Badge>
						{/if}
					</td>
					<td class="cell-num">{a.subscriberCount}</td>
					<td class="col-extra whitespace-nowrap">{formatDateShortYear(a.createdAt)}</td>
				</tr>
			{/each}
		</Table>
		<Pagination total={audiences.length} unit="audiences" />
	{/if}
</PageContent>
