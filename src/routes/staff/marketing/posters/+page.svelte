<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { clubToday } from '#lib/config.js';
	import { formatMonthYear } from '#lib/utils/format.js';
	import { getCalendarPoster } from '#lib/remote/calendar-poster.remote.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import StaffViews from '../../StaffViews.svelte';
	import { outreachViews } from '../views';

	// Last month through six ahead, as `YYYY-MM` in club time.
	const [year, monthNow] = clubToday().split('-').map(Number);
	const months = Array.from({ length: 8 }, (_, i) => {
		const d = new Date(Date.UTC(year, monthNow - 2 + i, 15));
		return {
			value: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
			label: formatMonthYear(d)
		};
	});

	let month = $state(months[1].value);
	const label = $derived(months.find((o) => o.value === month)?.label ?? month);
	const poster = $derived(await getCalendarPoster(month));
</script>

<PageHeader title={m.staff_outreach_title()} documentTitle={m.staff_calendar_poster_title()}>
	<StaffViews views={outreachViews} active="posters" />
</PageHeader>
<PageContent width="2xl">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<label class="flex flex-col gap-1">
			<span class="text-muted text-xs">{m.staff_calendar_poster_month_label()}</span>
			<Select size="sm" bind:value={month}>
				{#each months as o (o.value)}
					<option value={o.value}>{o.label}</option>
				{/each}
			</Select>
		</label>
		<Button size="sm" href={poster.png} download="cmc-calendar-{poster.month}.png">
			{m.staff_calendar_poster_download_label()}
		</Button>
	</div>
	<img
		src={poster.png}
		alt={m.staff_calendar_poster_alt_text({ month: label })}
		width="1080"
		height="1350"
		class="h-auto w-full rounded border border-base-300"
	/>
</PageContent>
