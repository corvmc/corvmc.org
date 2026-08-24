<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import { UnscheduleCampaignAction } from '$lib/components/shared/actions';
	import Button from '$lib/components/shared/Button.svelte';
	import DefinitionList from '$lib/components/shared/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/shared/DefinitionList/Fact.svelte';
	import { getCampaignDetail } from '$lib/remote/marketing.remote';
	import { sanitizeHtml } from '$lib/utils/markdown';

	let id = $derived(page.params.id!);
	let campaign = $derived(await getCampaignDetail(id));
</script>

{#if campaign}
	<PageHeader subtitle="Campaign" title={campaign.subject} backHref="/staff/marketing/campaigns">
		<StatusBadge status={campaign.status} />
		{#if campaign.status === 'draft'}
			<Button href="/staff/marketing/campaigns/{id}/edit" variant="default" size="sm">Edit</Button>
		{/if}
		{#if campaign.status === 'scheduled'}
			<UnscheduleCampaignAction
				campaignId={id}
				onsuccess={() => goto(resolve(`/staff/marketing/campaigns/${id}/edit`))}
			/>
		{/if}
	</PageHeader>
	<PageContent width="3xl">
		<div class="grid gap-6 lg:grid-cols-2 mb-6">
			<InfoCard title="Details">
				<DefinitionList>
					<Fact label="Status"><StatusBadge status={campaign.status} /></Fact>

					<Fact label="Audiences">{campaign.audiences.map((a) => a.name).join(', ') || '—'}</Fact>

					{#if campaign.recipientCount !== null}
						<Fact label="Recipients">{campaign.recipientCount}</Fact>
					{/if}

					{#if campaign.sentAt}
						<Fact label="Sent at">{new Date(campaign.sentAt).toLocaleString()}</Fact>
					{/if}

					{#if campaign.scheduledFor && !campaign.sentAt}
						<Fact label="Scheduled for">{new Date(campaign.scheduledFor).toLocaleString()}</Fact>
					{/if}

					<Fact label="Created">{new Date(campaign.createdAt).toLocaleDateString()}</Fact>
				</DefinitionList>
			</InfoCard>

			<InfoCard title="Markdown Source">
				<pre
					class="text-xs font-mono bg-base-200 p-3 rounded overflow-auto max-h-64 whitespace-pre-wrap">{campaign.markdownBody}</pre>
			</InfoCard>
		</div>

		<InfoCard title="Rendered Preview">
			<div class="border rounded-lg bg-white overflow-hidden">
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted/sanitized HTML (admin campaign HTML) -->
				{@html sanitizeHtml(campaign.htmlBody)}
			</div>
		</InfoCard>
	</PageContent>
{/if}
