<script lang="ts">
	// The favicon comes from the existing static/ directory, which SvelteKit
	// serves at the root just as the FastAPI static mount does. Referencing it
	// here also proves static/ is wired up correctly.
	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href="/assets/favicons/icon.svg" />
</svelte:head>

{@render children()}
