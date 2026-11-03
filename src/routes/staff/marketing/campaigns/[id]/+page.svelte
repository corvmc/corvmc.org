<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { formatHistoryTime, formatDateShortYear } from '$lib/utils/format';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import { UnscheduleCampaignAction } from '$lib/components/actions';
	import Button from '$lib/components/ui/Button.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import { getCampaignDetail } from '$lib/remote/marketing.remote';
	import { sanitizeHtml } from '$lib/utils/markdown';

	let id = $derived(page.params.id!);
	let campaign = $derived(await getCampaignDetail(id));
</script>

<PageHeader width="3xl" subtitle={m.staff_campaign()} title={campaign.subject}>
	<StatusBadge status={campaign.status} />
	{#if campaign.status === 'draft'}
		<Button href="/staff/marketing/campaigns/{id}/edit" variant="default" size="sm"
			>{m.staff_edit()}</Button
		>
	{/if}
	{#if campaign.status === 'scheduled'}
		<UnscheduleCampaignAction
			campaignId={id}
			onsuccess={() => goto(resolve(`/staff/marketing/campaigns/${id}/edit`))}
		/>
	{/if}
</PageHeader>
<PageContent width="3xl">
	<div class="mb-6 grid gap-6 lg:grid-cols-2">
		<InfoCard title={m.staff_details()}>
			<DefinitionList>
				<Fact label={m.staff_status()}><StatusBadge status={campaign.status} /></Fact>

				<Fact label={m.staff_audiences()}
					>{campaign.audiences.map((a) => a.name).join(', ') || '—'}</Fact
				>

				{#if campaign.recipientCount !== null}
					<Fact label={m.staff_recipients()}>{campaign.recipientCount}</Fact>
				{/if}

				{#if campaign.sentAt}
					<Fact label={m.staff_marketing_campaigns_id_sent_at()}
						>{formatHistoryTime(new Date(campaign.sentAt))}</Fact
					>
				{/if}

				{#if campaign.scheduledFor && !campaign.sentAt}
					<Fact label={m.staff_marketing_campaigns_id_scheduled()}
						>{formatHistoryTime(new Date(campaign.scheduledFor))}</Fact
					>
				{/if}

				<Fact label={m.staff_created()}>{formatDateShortYear(new Date(campaign.createdAt))}</Fact>
			</DefinitionList>
		</InfoCard>

		<InfoCard title={m.staff_marketing_campaigns_id_markdown_source()}>
			<pre
				class="max-h-64 overflow-auto code-block p-3 whitespace-pre-wrap">{campaign.markdownBody}</pre>
		</InfoCard>
	</div>

	<InfoCard title={m.staff_marketing_campaigns_id_rendered_preview()}>
		<div class="overflow-hidden rounded-lg border bg-white">
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted/sanitized HTML (admin campaign HTML) -->
			{@html sanitizeHtml(campaign.htmlBody)}
		</div>
	</InfoCard>
</PageContent>
