<!-- Harness for Card.svelte.spec.ts — Card/CardBody/CardTitle only compose. -->
<script lang="ts">
	import Card from './Card.svelte';
	import CardBody from './CardBody.svelte';
	import CardTitle from './CardTitle.svelte';
	import type { CardTone } from './Card.svelte';
	import type { CardTitleSize } from './CardTitle.svelte';

	let {
		tone,
		bordered = false,
		padding,
		row = false,
		center = false,
		size,
		level
	}: {
		tone?: CardTone;
		bordered?: boolean;
		padding?: 'sm' | 'md';
		row?: boolean;
		center?: boolean;
		size?: CardTitleSize;
		level?: 2 | 3 | 4;
	} = $props();
</script>

<Card {tone} {bordered}>
	<CardBody {padding} {row} {center}>
		<CardTitle {size} {level}>Payment</CardTitle>
		<p>$24.00</p>
	</CardBody>
</Card>
