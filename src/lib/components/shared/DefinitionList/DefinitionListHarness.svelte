<script lang="ts">
	// Test-only harness: `Fact` must be used inside `DefinitionList`, and the
	// structural assertions need a realistic mix of the three value modes
	// (plain, mono, arbitrary markup).
	import DefinitionList from './DefinitionList.svelte';
	import Fact from './Fact.svelte';
</script>

<DefinitionList>
	<Fact label="Name" value="Bass Cabinet" />
	<Fact label="ID" mono>abc-123</Fact>
	<Fact label="Link"><a href="#open">Open</a></Fact>
</DefinitionList>
