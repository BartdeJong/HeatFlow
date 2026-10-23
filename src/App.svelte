<script lang="ts">
  import RoomView from './ui/RoomView.svelte';
  import Sidebar from './ui/Sidebar.svelte';
  import Header from './ui/Header.svelte';
  import Playback from './ui/Playback.svelte';
</script>
<Header />
<main>
  <div class="workspace"><Playback /><RoomView /></div>
  <Sidebar />
</main>
<style>
main { display:grid; grid-template-columns:minmax(0,1fr) 380px; height:calc(100dvh - 64px); }
.workspace { display:flex; flex-direction:column; min-width:0; min-height:0; }
@media(max-width:899px) { main { height:auto; min-height:calc(100dvh - 64px); grid-template-columns:minmax(0,1fr); } .workspace { height: max(680px, 75dvh); } }
</style>
