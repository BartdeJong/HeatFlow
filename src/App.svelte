<script lang="ts">
  import { app } from './state/app.svelte';
  import RoomView from './ui/RoomView.svelte';
  import Sidebar from './ui/Sidebar.svelte';
  import Header from './ui/Header.svelte';
  import Playback from './ui/Playback.svelte';
</script>
{#if !app.focusView}<Header />{/if}
<main class="app-main" class:focused={app.focusView}>
  <div class="workspace" class:focused={app.focusView}>
    {#if !app.focusView}<Playback />{/if}
    <RoomView />
  </div>
  {#if !app.focusView}<Sidebar />{/if}
</main>
<style>
.app-main { display:grid; grid-template-columns:minmax(0,1fr) 380px; height:calc(100dvh - 64px); }
.workspace { display:flex; flex-direction:column; min-width:0; min-height:0; }
.app-main.focused { display:block; height:100dvh; }
.workspace.focused { height:100dvh; }
@media(max-width:899px) { .app-main { height:auto; min-height:calc(100dvh - 64px); grid-template-columns:minmax(0,1fr); } .workspace { height: max(680px, 75dvh); } }
</style>
