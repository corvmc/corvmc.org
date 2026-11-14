<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Card from '#lib/components/ui/Card/Card.svelte';
	import CardBody from '#lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import StatCard from '#lib/components/ui/StatCard.svelte';
	import StatGrid from '#lib/components/ui/StatGrid.svelte';
	import { getMusicSalesReport } from '#lib/remote/staff-music.remote.js';
	import { formatCents } from '#lib/utils/format.js';
	import StaffViews from '../../StaffViews.svelte';
	import { reportViews } from '../views';

	/** Release sales across every band, moved here from the Music page (#2766). */
	const sales = $derived(await getMusicSalesReport());
</script>

<PageHeader title={m.staff_reports_title()} documentTitle={m.staff_reports_music_title()}>
	<StaffViews views={reportViews} active="music" collapse />
</PageHeader>

<PageContent>
	<Card>
		<CardBody>
			<CardTitle>{m.staff_music_sales_title()}</CardTitle>
			<StatGrid cols={5}>
				<StatCard title={m.staff_music_sales_title()} value={String(sales.sales)} />
				<StatCard title={m.staff_music_gross_title()} value={formatCents(sales.grossCents)} />
				<StatCard title={m.staff_music_bands_title()} value={formatCents(sales.toBandsCents)} />
				<!-- Card processing comes off the top, funded by both sides in
				     proportion, so it is shown beside them rather than folded into
				     either figure. -->
				<StatCard title={m.staff_music_card_fees_title()} value={formatCents(sales.feesCents)} />
				<StatCard
					title={m.staff_music_cmc_kept_title()}
					value={formatCents(sales.toCollectiveCents)}
				/>
			</StatGrid>
			<!-- The number the refusable-cut decision is judged on, reported rather
			     than assumed. -->
			<p class="text-muted">
				{m.staff_music_realised_take_what_buyers_paid_text({
					toFixed: (sales.realisedTakeBps / 100).toFixed(1)
				})}
				{#if sales.freeSales > 0}
					{m.staff_music_were_free_downloads_text({
						freeSales: sales.freeSales,
						sales: sales.sales
					})}
				{/if}
			</p>
		</CardBody>
	</Card>
</PageContent>
