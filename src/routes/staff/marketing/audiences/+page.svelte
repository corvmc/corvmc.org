<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getAudiences } from '$lib/remote/marketing.remote';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import { CreateAudienceAction } from '$lib/components/shared/actions';
	import Badge from '$lib/components/shared/Badge.svelte';
	import Table from '$lib/components/shared/Table.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { EntityIdentity } from '$lib/components/shared/entity';
	import { formatDateShortYear } from '$lib/utils/format';

	let audiences = $derived(await getAudiences());
</script>

<PageHeader title="Audiences" subtitle="Marketing">
	<CreateAudienceAction
		onsuccess={(result) => {
			const r = result as { audienceId?: string };
			if (r?.audienceId) goto(resolve(`/staff/marketing/audiences/${r.audienceId}`));
		}}
	/>
</PageHeader>
<PageContent>
	{#if audiences.length === 0}
		<EmptyState description="No audiences yet. Create one to start building your email lists." />
	{:else}
		<Table>
			{#snippet head()}
				<th>Audience</th>
				<th class="col-support w-px">Opt-in</th>
				<th class="cell-num">Subscribers</th>
				<th class="col-extra whitespace-nowrap">Created</th>
			{/snippet}
			{#each audiences as a (a.id)}
				{@const href = resolve(`/staff/marketing/audiences/${a.id}`)}
				<tr class="hover cursor-pointer" use:rowLink={href}>
					<td class="cell-primary"><EntityIdentity ref={a.ref} /></td>
					<td class="col-support w-px">
						{#if a.systemKey}
							<Badge size="sm" variant="info" class="whitespace-nowrap">Built-in</Badge>
						{:else}
							<Badge size="sm" variant={a.allowOptIn ? 'success' : 'ghost'}>
								{a.allowOptIn ? 'Public' : 'Staff only'}
							</Badge>
						{/if}
					</td>
					<td class="cell-num">{a.subscriberCount}</td>
					<td class="col-extra whitespace-nowrap">{formatDateShortYear(a.createdAt)}</td>
				</tr>
			{/each}
		</Table>
	{/if}
</PageContent>
