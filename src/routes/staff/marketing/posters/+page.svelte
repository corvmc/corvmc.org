<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { clubToday, type PosterFormat } from '#lib/config.js';
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

	// Sizes in CSS px, for the preview's aspect ratio.
	const formats: { value: PosterFormat; label: string; width: number; height: number }[] = [
		{ value: 'letter', label: m.staff_calendar_poster_letter_label(), width: 816, height: 1056 },
		{
			value: 'tabloid',
			label: m.staff_calendar_poster_tabloid_label(),
			width: 1056,
			height: 1632
		},
		{ value: 'social', label: m.staff_calendar_poster_social_label(), width: 1080, height: 1350 }
	];

	let month = $state(months[1].value);
	let format = $state<PosterFormat>('letter');
	const label = $derived(months.find((o) => o.value === month)?.label ?? month);
	const poster = $derived(await getCalendarPoster({ month, format }));
	const size = $derived(formats.find((f) => f.value === poster.format) ?? formats[0]);
</script>

<PageHeader
	title={m.staff_outreach_title()}
	documentTitle={m.staff_calendar_poster_title()}
	width="2xl"
>
	<StaffViews views={outreachViews} active="posters" />
</PageHeader>
<PageContent width="2xl">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div class="flex flex-wrap items-end gap-3">
			<label class="flex flex-col gap-1">
				<span class="text-muted text-xs">{m.staff_calendar_poster_month_label()}</span>
				<Select size="sm" bind:value={month}>
					{#each months as o (o.value)}
						<option value={o.value}>{o.label}</option>
					{/each}
				</Select>
			</label>
			<label class="flex flex-col gap-1">
				<span class="text-muted text-xs">{m.staff_calendar_poster_format_label()}</span>
				<Select size="sm" bind:value={format}>
					{#each formats as o (o.value)}
						<option value={o.value}>{o.label}</option>
					{/each}
				</Select>
			</label>
		</div>
		<Button
			size="sm"
			href={poster.file}
			download="cmc-calendar-{poster.month}-{poster.format}.{poster.extension}"
		>
			{m.staff_calendar_poster_download_label()}
		</Button>
	</div>
	<img
		src={poster.preview}
		alt={m.staff_calendar_poster_alt_text({ month: label })}
		width={size.width}
		height={size.height}
		class="h-auto w-full rounded border border-base-300"
	/>
</PageContent>
