<script lang="ts" module>
	/** The plain value, exported so the spec asserts the fixture rather than copy. */
	export const PLAIN_VALUE = 'Bass Cabinet';
</script>

<script lang="ts">
	// Test-only harness: `Fact` must be used inside `DefinitionList`, and the
	// structural assertions need a realistic mix of the three value modes
	// (plain, mono, arbitrary markup).
	import DefinitionList from './DefinitionList.svelte';
	import Fact from './Fact.svelte';
</script>

<DefinitionList>
	<Fact label="Name" value={PLAIN_VALUE} />
	<Fact label="ID" mono>abc-123</Fact>
	<Fact label="Link"><a href="#open">Open</a></Fact>
</DefinitionList>
