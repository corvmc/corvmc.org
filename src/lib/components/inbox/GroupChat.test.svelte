<!--
	Test harness for GroupChat.svelte: the mute button's icon-only trigger needs
	the `Tooltip.Provider` the app mounts in `+layout.svelte`.
-->
<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import GroupChat from './GroupChat.svelte';
	import type { ComponentProps } from 'svelte';

	let props: ComponentProps<typeof GroupChat> = $props();
</script>

<Tooltip.Provider>
	<GroupChat {...props} />
</Tooltip.Provider>
