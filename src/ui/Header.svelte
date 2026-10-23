<script lang="ts">
  import { app, setRoom } from '../state/app.svelte';
  import { deleteRoom, listSavedRooms, saveRoom } from '../persist/storage';
  import { shareUrl } from '../persist/share';
  let menuOpen = $state(false);
  let saved = $state(listSavedRooms());
  let name = $state('My room');
  let selected = $state('');
  let message = $state('');

  const names = $derived(Object.keys(saved).sort());
  function flash(text: string) {
    message = text;
    setTimeout(() => {
      if (message === text) message = '';
    }, 3000);
  }

  function onSave() {
    const n = name.trim();
    if (!n) return flash('Enter a name first.');
    if (!saveRoom(n, $state.snapshot(app.room))) return flash('Could not save (storage unavailable).');
    saved = listSavedRooms();
    selected = n;
    flash(`Saved “${n}”.`);
  }

  function onLoad() {
    const room = saved[selected];
    if (!room) return;
    setRoom(room);
    name = selected;
    flash(`Loaded “${selected}”.`);
  }

  function onDelete() {
    if (!selected) return;
    deleteRoom(selected);
    saved = listSavedRooms();
    selected = '';
  }

  async function onShare() {
    const url = shareUrl($state.snapshot(app.room));
    history.replaceState(null, '', url);
    try {
      await navigator.clipboard.writeText(url);
      flash('Link copied to clipboard.');
    } catch {
      flash('Link placed in the address bar.');
    }
  }

</script>
<svelte:window onclick={(event) => { if (event.target instanceof Element && !event.target.closest('.save-menu')) menuOpen = false; }} onkeydown={(event) => { if (event.key === 'Escape' && menuOpen) { menuOpen = false; document.getElementById('save-menu-toggle')?.focus(); } }} />
<header class="app-header">
  <div class="brand" aria-label="HeatFlow"><span class="brand-mark">≋</span>HeatFlow <span class="brand-subtitle">THERMAL STUDIO</span></div>
  <div class="save-menu">
    <button class="save-toggle" id="save-menu-toggle" aria-expanded={menuOpen} aria-controls="save-share-panel" onclick={() => menuOpen = !menuOpen}>Save &amp; Share <span aria-hidden="true">↗</span></button>
    <div class="save-popover" id="save-share-panel" role="region" aria-label="Save and share room" hidden={!menuOpen}>
  <fieldset>
    <legend>Save &amp; share</legend>
    <div class="row">
      <input type="text" bind:value={name} maxlength="40" aria-label="Room name" />
      <button onclick={onSave}>Save</button>
    </div>
    {#if names.length}
      <div class="row">
        <select bind:value={selected} aria-label="Saved rooms">
          <option value="">Saved rooms…</option>
          {#each names as n}<option value={n}>{n}</option>{/each}
        </select>
        <button onclick={onLoad} disabled={!selected}>Load</button>
        <button onclick={onDelete} disabled={!selected} aria-label="Delete saved room">×</button>
      </div>
    {/if}
    <button onclick={onShare}>↗ Copy share link</button>
    <p class="hint status" aria-live="polite">{message}</p>
  </fieldset>

</div></div>
</header>
<style>
.app-header { height: 64px; padding: 0 24px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--border); background:var(--surface); gap:12px; }
.brand { display:flex; align-items:center; gap:10px; color:var(--text); text-decoration:none; font-weight:650; font-size:20px; letter-spacing:-.6px; }
.brand-mark { display:grid; place-items:center; width:32px; height:32px; border-radius:9px; background:var(--accent); color:#19130e; font-size:30px; }
.brand-subtitle { font-size:9px; letter-spacing:1.5px; color:var(--muted); margin-left:10px; }
.save-menu { position:relative; z-index:20; }
.save-toggle { list-style:none; padding:9px 12px; border:1px solid var(--border); border-radius:8px; font-size:12px; cursor:pointer; white-space:nowrap; }
.save-toggle span { margin-left:12px; color:var(--accent); }
.save-popover { position:absolute; right:0; top:48px; width:min(360px, calc(100vw - 32px)); padding:12px; background:var(--surface); border:1px solid var(--border); border-radius:12px; box-shadow:0 20px 70px #0008; }
@media(max-width:600px) { .app-header { padding:0 16px; } .brand-subtitle { display:none; } }
</style>
