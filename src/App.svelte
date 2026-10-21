<script lang="ts">
  import RoomView from './ui/RoomView.svelte';
  import Sidebar from './ui/Sidebar.svelte';
</script>

<main>
  <RoomView />
  <Sidebar />
</main>

<style>
  main {
    display: grid;
    grid-template-columns: 1fr 340px;
    height: 100dvh;
  }
  @media (max-width: 800px) {
    main {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(0, 50dvh) minmax(0, 1fr);
    }
  }
</style>
