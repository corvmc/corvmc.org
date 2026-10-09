<!--
	Test harness for PageHeader's actions slot. A `Tooltip.Provider` is needed
	because Button's tooltip throws without one (the app mounts it in the root
	layout). The confirm Action opens a Modal whose buttons must keep their size.
-->
<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import PageHeader from './PageHeader.svelte';
	import Button from './Button.svelte';
	import Action from './Action.svelte';
</script>

<Tooltip.Provider delayDuration={300}>
	<PageHeader title="Volunteering" documentTitle={null}>
		<Button>Unsized</Button>
		<Button size="lg">Large</Button>
		<Action action={async () => undefined} label="New shift" confirm="Make it?" />
	</PageHeader>
	<Button>Outside</Button>
</Tooltip.Provider>
