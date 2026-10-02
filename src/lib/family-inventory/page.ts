/**
 * The whole family-facing app: one static page, no build step, no
 * framework. Fetches /family/api/* directly. Deliberately dependency-free
 * so it has nothing in common with the old event-sourced Food OS stack.
 */
export const FAMILY_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Our Food</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='22' fill='%231c1b19'/><text x='50' y='70' font-size='56' text-anchor='middle'>🍲</text></svg>" />
<link rel="apple-touch-icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='22' fill='%231c1b19'/><text x='50' y='70' font-size='56' text-anchor='middle'>🍲</text></svg>" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="Our Food" />
<meta name="theme-color" content="#1c1b19" />
<style>
  :root { color-scheme: light dark; }
  html { scroll-behavior: smooth; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #f4f3ef;
    color: #1c1b19;
    padding-bottom: 96px;
  }
  header {
    position: sticky; top: 0; z-index: 10;
    background: #1c1b19; color: #fff;
    padding: 14px 16px calc(14px + env(safe-area-inset-top));
  }
  header h1 { margin: 0; font-size: 19px; font-weight: 700; }
  header p { margin: 2px 0 0; font-size: 12px; opacity: 0.7; }
  main { padding: 12px; max-width: 640px; margin: 0 auto; }
  details.section { margin-bottom: 20px; }
  details.section summary {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 14px 16px; cursor: pointer; list-style: none;
    font-size: 15px; font-weight: 700; color: #1c1b19;
    background: #fff; border: 1px solid #e3e1da; border-radius: 12px;
    -webkit-tap-highlight-color: transparent;
  }
  details.section summary:active { background: #efeee8; }
  details.section summary::-webkit-details-marker { display: none; }
  details.section summary::after {
    content: '▾'; font-size: 16px; color: #9a988f; transition: transform 0.15s ease; flex-shrink: 0;
  }
  details.section:not([open]) summary::after { transform: rotate(-90deg); }
  details.section[open] summary { margin-bottom: 10px; }
  details.section .section-hint { padding: 0 2px; }
  .section-count { font-weight: 500; font-size: 13px; color: #9a988f; }
  .cat-heading {
    font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
    color: #6b6a63; margin: 14px 0 6px;
  }
  .cat-heading:first-child { margin-top: 0; }
  .shop-meal-group { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin: 14px 0 6px; }
  .shop-meal-group:first-child { margin-top: 0; }
  .shop-meal-group .cat-heading { margin: 0; }
  .shop-meal-link { font-size: 12px; font-weight: 600; color: #2f6f4f; text-decoration: none; white-space: nowrap; }
  .plan-notes {
    width: 100%; padding: 11px 12px; border-radius: 10px; border: 1px solid #ddd;
    font-size: 14px; margin-bottom: 8px; background: #fff;
  }
  .plan-hint, .section-hint { font-size: 11.5px; color: #9a988f; margin: 0 0 10px; line-height: 1.4; }
  .plan-btn {
    width: 100%; padding: 14px 8px; border-radius: 12px; border: none;
    background: #2f6f4f; color: #fff; font-size: 15px; font-weight: 700; margin-bottom: 8px;
  }
  .prefs-link {
    display: block; width: 100%; text-align: center; padding: 4px; margin-bottom: 16px;
    background: none; border: none; color: #9a988f; font-size: 12px; font-weight: 600;
  }
  #planResult { display: none; margin-bottom: 16px; }
  .plan-loading {
    display: flex; align-items: center; gap: 10px; padding: 14px; font-size: 14px;
    color: #3d3c37; background: #fff; border: 1px solid #e3e1da; border-radius: 12px;
  }
  .spinner {
    width: 18px; height: 18px; flex-shrink: 0; border-radius: 50%;
    border: 3px solid #e3e1da; border-top-color: #2f6f4f; animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  #planResult .plan-headline { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
  #planResult .plan-text { font-size: 14px; line-height: 1.5; margin-bottom: 12px; color: #3d3c37; }
  .meal-carousel {
    display: flex; gap: 10px; overflow-x: auto; scroll-snap-type: x mandatory;
    padding-bottom: 4px; margin-bottom: 10px; -webkit-overflow-scrolling: touch;
  }
  .meal-card {
    background: #fff; border-radius: 12px; padding: 12px 14px;
    border: 1px solid #e3e1da; flex: 0 0 82%; scroll-snap-align: start;
  }
  .meal-photo {
    width: 100%; height: 120px; object-fit: cover; border-radius: 8px;
    margin-bottom: 8px; background: #efeee8; display: block;
  }
  .meal-name { font-size: 15px; font-weight: 700; }
  .meal-reason { font-size: 12.5px; color: #6b6a63; margin-top: 2px; }
  .meal-items { font-size: 12.5px; color: #6b6a63; margin-top: 8px; line-height: 1.5; }
  .meal-empty {
    background: #fff; border-radius: 12px; padding: 14px; border: 1px solid #e3e1da;
    font-size: 14px; color: #6b6a63; margin-bottom: 10px;
  }
  .almost-heading {
    font-size: 13px; font-weight: 700; color: #6b6a63; margin: 4px 0 8px;
  }
  .meal-card.locked { opacity: 0.72; }
  .meal-card.locked .meal-photo { filter: grayscale(55%); }
  .meal-missing { font-size: 12.5px; color: #a3401a; margin-top: 8px; line-height: 1.5; font-weight: 600; }
  .unlock-btn {
    width: 100%; margin-top: 10px; padding: 11px; border-radius: 10px;
    border: 1px solid #2f6f4f; background: none; color: #2f6f4f; font-size: 13px; font-weight: 700;
  }
  .unlock-btn:disabled { opacity: 0.6; }
  .stepper { display: flex; align-items: center; gap: 14px; margin-bottom: 4px; }
  .stepper-btn {
    width: 38px; height: 38px; border-radius: 10px; border: 1px solid #ddd;
    background: #f7f6f3; font-size: 18px; line-height: 1; flex-shrink: 0;
  }
  .stepper-value { font-size: 16px; font-weight: 700; min-width: 24px; text-align: center; }
  .plan-refresh {
    display: block; width: 100%; text-align: center; padding: 10px; margin-top: 4px;
    background: none; border: none; color: #4a5b8c; font-size: 13px; font-weight: 600; text-decoration: underline;
  }
  #shoppingListSection {
    background: #fff; border-radius: 12px; padding: 4px 14px; border: 1px solid #e3e1da;
  }
  #shoppingListSection .shop-item:last-child { border-bottom: none; }
  .shop-item { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid #efeee8; flex-wrap: wrap; }
  .shop-info { flex: 1; min-width: 100px; }
  .shop-name { font-size: 14px; font-weight: 600; }
  .shop-qty { font-size: 12px; color: #6b6a63; }
  .shop-link {
    font-size: 12px; font-weight: 600; padding: 7px 10px; border-radius: 8px;
    background: #2f6f4f; color: #fff; text-decoration: none; flex-shrink: 0;
  }
  .shop-add {
    font-size: 12px; padding: 7px 10px; border-radius: 8px; border: 1px solid #ddd;
    background: #f7f6f3; flex-shrink: 0;
  }
  .shop-cancel {
    font-size: 12px; padding: 7px 10px; border-radius: 8px; border: 1px solid #ddd;
    background: #f7f6f3; color: #a3401a; flex-shrink: 0;
  }
  .cook-btn {
    width: 100%; margin-top: 10px; padding: 11px; border-radius: 10px; border: none;
    background: #2f6f4f; color: #fff; font-size: 13px; font-weight: 700;
  }
  .plan-btn:disabled, .cook-btn:disabled, .sheet .actions button:disabled { opacity: 0.6; }
  .item {
    background: #fff; border-radius: 12px; padding: 10px 12px;
    display: flex; align-items: center; gap: 8px; margin-bottom: 6px;
    border: 1px solid #e3e1da;
  }
  .item .info { flex: 1; min-width: 0; }
  .item .name { font-size: 15px; font-weight: 600; line-height: 1.25; }
  .item .meta { font-size: 12px; color: #6b6a63; margin-top: 1px; }
  .badge { font-size: 10px; padding: 2px 6px; border-radius: 999px; background: #eee; margin-left: 6px; }
  .badge.low { background: #fde3d6; color: #a3401a; }
  .badge.soon { background: #fdf0c8; color: #8a6a06; }
  .qtybtn {
    width: 34px; height: 34px; border-radius: 10px; border: 1px solid #ddd;
    background: #f7f6f3; font-size: 18px; line-height: 1; flex-shrink: 0;
  }
  .usedbtn { font-size: 11px; padding: 6px 8px; border-radius: 8px; border: 1px solid #ddd; background: #f7f6f3; flex-shrink: 0; }
  .empty { text-align: center; color: #6b6a63; padding: 40px 16px; font-size: 14px; }
  .list-toolbar { display: flex; gap: 8px; margin-bottom: 8px; }
  .select-toggle, .select-all-btn, .select-clear-btn {
    font-size: 12px; font-weight: 600; padding: 6px 10px; border-radius: 8px;
    border: 1px solid #ddd; background: #f7f6f3; color: #1c1b19;
  }
  .item.selectable { cursor: pointer; }
  .item-check { width: 20px; height: 20px; flex-shrink: 0; }
  .add-food-btn {
    font-size: 12px; font-weight: 600; padding: 6px 10px; border-radius: 8px;
    border: none; background: #2f6f4f; color: #fff; margin-left: auto;
  }
  .bulk-bar {
    display: none; align-items: center; justify-content: space-between; gap: 10px;
    position: fixed; bottom: 16px; left: 16px; right: 16px; max-width: 608px; margin: 0 auto;
    padding: 14px 16px; border-radius: 14px; background: #1c1b19; color: #fff; font-size: 13px;
  }
  .bulk-remove {
    padding: 10px 14px; border-radius: 10px; border: none; background: #a3401a; color: #fff;
    font-weight: 700; font-size: 13px; flex-shrink: 0;
  }
  .bulk-remove:disabled { opacity: 0.5; }
  dialog { border: none; border-radius: 16px; padding: 0; width: min(420px, 92vw); }
  dialog::backdrop { background: rgba(0,0,0,0.4); }
  .sheet { padding: 18px; }
  .sheet h3 { margin: 0 0 12px; font-size: 16px; }
  .sheet label { display: block; font-size: 12px; color: #6b6a63; margin: 10px 0 4px; }
  .sheet input, .sheet select, .sheet textarea {
    width: 100%; padding: 10px; border-radius: 10px; border: 1px solid #ddd; font-size: 15px;
  }
  .sheet .row { display: flex; gap: 8px; }
  .sheet .actions { display: flex; gap: 8px; margin-top: 16px; }
  .sheet .actions button { flex: 1; padding: 12px; border-radius: 10px; border: none; font-size: 14px; font-weight: 600; }
  .sheet .actions .save { background: #2f6f4f; color: #fff; }
  .sheet .actions .cancel { background: #eee; }
  .sheet .actions .delete { background: #fde3d6; color: #a3401a; }
  .keygate { padding: 40px 20px; text-align: center; }
  .keygate input { width: 100%; padding: 12px; border-radius: 10px; border: 1px solid #ddd; font-size: 16px; margin-top: 12px; }
  .keygate button { margin-top: 10px; width: 100%; padding: 12px; border-radius: 10px; border: none; background: #1c1b19; color: #fff; font-weight: 600; }
  @media (prefers-color-scheme: dark) {
    body { background: #15140f; color: #f1efe9; }
    .item, .meal-card, .meal-empty, .plan-loading { background: #211f18; border-color: #332f23; color: #f1efe9; }
    .spinner { border-color: #3a362a; border-top-color: #2f6f4f; }
    .meal-photo { background: #2a2820; }
    .qtybtn, .usedbtn, .shop-add, .shop-cancel, .select-toggle, .select-all-btn, .select-clear-btn, .stepper-btn { background: #2a2820; border-color: #3a362a; color: #f1efe9; }
    .sheet input, .sheet select, .sheet textarea, .plan-notes { background: #211f18; border-color: #3a362a; color: #f1efe9; }
    .sheet .actions .cancel { background: #2a2820; color: #f1efe9; }
    .shop-item { border-color: #2a2820; }
    #shoppingListSection { background: #211f18; border-color: #332f23; }
    details.section summary { background: #211f18; border-color: #332f23; color: #f1efe9; }
    details.section summary:active { background: #2a2820; }
    #planResult .plan-text { color: #d7d5cc; }
    .plan-refresh { color: #93a3d6; }
  }
</style>
</head>
<body>
<header>
  <h1>Our Food</h1>
  <p id="subtitle">What's actually in the house</p>
</header>
<main>
  <div id="keygate" class="keygate" style="display:none">
    <p>Enter the family key to open the list (you only need to do this once per device).</p>
    <input id="keyInput" type="text" placeholder="family key" autocapitalize="off" autocorrect="off" />
    <button onclick="saveKey()">Open</button>
  </div>
  <div id="app" style="display:none">
    <div class="section-hint">Based on what's in the house — tap to see tonight's options, built entirely from stock.</div>
    <input id="planNotes" class="plan-notes" placeholder="Anything different tonight? e.g. 7 of us, or no veggie needed" />
    <button class="plan-btn" id="planBtn" onclick="planMeal()">What can we eat?</button>
    <button class="prefs-link" id="prefsBtn" onclick="openPrefs()">⚙ Household defaults</button>
    <div id="planResult"></div>

    <details class="section" id="inventoryDetails">
      <summary><span>What's in the house</span><span class="section-count" id="invCount"></span></summary>
      <div class="section-hint">Everything currently logged. Tap an item to adjust it, or log something new.</div>
      <div class="list-toolbar">
        <button class="select-toggle" id="selectToggleBtn" onclick="toggleSelectMode()">Select</button>
        <button class="select-all-btn" id="selectAllBtn" onclick="selectAllItems()" style="display:none">Select all</button>
        <button class="select-clear-btn" id="selectClearBtn" onclick="clearSelection()" style="display:none">Clear</button>
        <button class="add-food-btn" id="addFab" onclick="openAdd()">+ Add food</button>
      </div>
      <div id="list"></div>
    </details>

    <details class="section" id="shoppingDetails" style="display:none">
      <summary><span>What you'll need</span><span class="section-count" id="shopCount"></span></summary>
      <div class="section-hint">Things you've chosen to buy to unlock more meals — pick them from the "Unlock more meals" row above after tapping "What can we eat?".</div>
      <div id="shoppingListSection"></div>
    </details>
  </div>
</main>
<div class="bulk-bar" id="bulkBar">
  <span id="bulkCount">0 selected</span>
  <button class="bulk-remove" id="bulkRemoveBtn" onclick="bulkDeleteSelected()" disabled>Remove selected</button>
</div>

<dialog id="itemDialog">
  <div class="sheet">
    <h3 id="dialogTitle">Add food</h3>
    <input type="hidden" id="editId" />
    <label>What is it?</label>
    <input id="editName" placeholder="e.g. Chicken breast" />
    <div class="row">
      <div style="flex:1">
        <label>How much</label>
        <input id="editQty" inputmode="decimal" placeholder="e.g. 500" />
      </div>
      <div style="flex:1">
        <label>Unit</label>
        <input id="editUnit" placeholder="g, pack, each…" />
      </div>
    </div>
    <label>Notes (optional)</label>
    <textarea id="editNotes" rows="2" placeholder="anything worth remembering"></textarea>
    <div class="actions">
      <button class="cancel" id="cancelBtn" onclick="closeDialog()">Cancel</button>
      <button class="delete" id="deleteBtn" style="display:none" onclick="deleteItem()">Remove</button>
      <button class="save" id="saveBtn" onclick="saveItem()">Save</button>
    </div>
  </div>
</dialog>

<dialog id="prefsDialog">
  <div class="sheet">
    <h3>Household defaults</h3>
    <label>How many people</label>
    <div class="stepper">
      <button type="button" class="stepper-btn" onclick="adjustPeopleCount(-1)">−</button>
      <span class="stepper-value" id="peopleCountValue">6</span>
      <button type="button" class="stepper-btn" onclick="adjustPeopleCount(1)">+</button>
    </div>
    <label>Dietary constraints (optional)</label>
    <input id="prefDietary" placeholder="e.g. no shellfish, no nuts" />
    <label>Spice level</label>
    <select id="prefSpice">
      <option value="">No preference</option>
      <option value="mild">Mild</option>
      <option value="medium">Medium</option>
      <option value="hot">Hot</option>
    </select>
    <div class="actions">
      <button class="cancel" onclick="closePrefs()">Cancel</button>
      <button class="save" onclick="savePrefs()">Save</button>
    </div>
  </div>
</dialog>

<script>
let FAMILY_KEY = localStorage.getItem('familyKey') || '';
let ITEMS = [];
var SELECT_MODE = false;
var SELECTED_IDS = {};

function wireCollapsible(id, storageKey, defaultOpen) {
  var el = document.getElementById(id);
  if (!el) return;
  var stored = null;
  try { stored = localStorage.getItem(storageKey); } catch (e) {}
  el.open = stored === null ? defaultOpen : stored === 'true';
  el.addEventListener('toggle', function () {
    try { localStorage.setItem(storageKey, el.open ? 'true' : 'false'); } catch (e) {}
  });
}
wireCollapsible('inventoryDetails', 'invSectionOpen', false);
wireCollapsible('shoppingDetails', 'shopSectionOpen', true);

function apiFetch(path, options) {
  options = options || {};
  options.headers = Object.assign({ 'x-family-key': FAMILY_KEY, 'content-type': 'application/json' }, options.headers || {});
  if (!options.signal) options.signal = AbortSignal.timeout(30000);
  return fetch(path, options).then(function (r) {
    return r.json().then(function (body) { return { status: r.status, body: body }; });
  }).catch(function (err) {
    var message = (err && err.name === 'TimeoutError') ? 'Request took too long and timed out.' : 'Could not reach the server — check your connection and try again.';
    return { status: 0, body: { ok: false, error: message } };
  });
}

function saveKey() {
  var k = document.getElementById('keyInput').value.trim();
  if (!k) return;
  FAMILY_KEY = k;
  localStorage.setItem('familyKey', k);
  boot();
}

function boot() {
  var params = new URLSearchParams(location.search);
  if (params.get('key')) {
    FAMILY_KEY = params.get('key');
    localStorage.setItem('familyKey', FAMILY_KEY);
  }
  if (!FAMILY_KEY) {
    document.getElementById('keygate').style.display = 'block';
    return;
  }
  loadInventory();
  loadShoppingList();
  loadPreferences();
  loadPlan();
}

var PREFS = { peopleCount: 6, dietaryNotes: null, spiceLevel: null };

function loadPreferences() {
  apiFetch('/family/api/preferences').then(function (res) {
    if (!res.body.ok) return;
    PREFS = { peopleCount: res.body.peopleCount, dietaryNotes: res.body.dietaryNotes, spiceLevel: res.body.spiceLevel };
  });
}

function openPrefs() {
  document.getElementById('peopleCountValue').textContent = String(PREFS.peopleCount);
  document.getElementById('prefDietary').value = PREFS.dietaryNotes || '';
  document.getElementById('prefSpice').value = PREFS.spiceLevel || '';
  document.getElementById('prefsDialog').showModal();
}

function closePrefs() {
  document.getElementById('prefsDialog').close();
}

function adjustPeopleCount(delta) {
  var el = document.getElementById('peopleCountValue');
  var next = Math.max(1, parseInt(el.textContent, 10) + delta);
  el.textContent = String(next);
}

function savePrefs() {
  var peopleCount = parseInt(document.getElementById('peopleCountValue').textContent, 10);
  var dietaryNotes = document.getElementById('prefDietary').value.trim();
  var spiceLevel = document.getElementById('prefSpice').value;
  apiFetch('/family/api/preferences', {
    method: 'PATCH',
    body: JSON.stringify({ peopleCount: peopleCount, dietaryNotes: dietaryNotes || null, spiceLevel: spiceLevel || null }),
  }).then(function (res) {
    if (!reportIfFailed(res)) return;
    PREFS = { peopleCount: res.body.peopleCount, dietaryNotes: res.body.dietaryNotes, spiceLevel: res.body.spiceLevel };
    closePrefs();
  });
}

function loadInventory() {
  apiFetch('/family/api/inventory').then(function (res) {
    if (res.status === 401) {
      localStorage.removeItem('familyKey');
      FAMILY_KEY = '';
      document.getElementById('app').style.display = 'none';
      document.getElementById('addFab').style.display = 'none';
      document.getElementById('keygate').style.display = 'block';
      return;
    }
    document.getElementById('keygate').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    updateFabVisibility();
    ITEMS = res.body.items || [];
    render();
  });
}

function render() {
  var html = '';
  if (ITEMS.length === 0) {
    html = '<div class="empty">Nothing logged yet. Tap "Add food" to start.</div>';
  } else {
    // The server already returns items grouped by supermarket aisle, then
    // A-Z within each — just drop in a heading whenever the group changes.
    var lastCategory = null;
    ITEMS.forEach(function (item) {
      var category = item.category || 'Other';
      if (category !== lastCategory) {
        html += '<div class="cat-heading">' + escapeHtml(category) + '</div>';
        lastCategory = category;
      }
      html += renderItem(item);
    });
  }
  document.getElementById('list').innerHTML = html;
  document.getElementById('invCount').textContent = ITEMS.length + (ITEMS.length === 1 ? ' item' : ' items');
}

function renderItem(item) {
  var qty = item.quantity != null ? (item.quantity + (item.unit ? ' ' + item.unit : '')) : (item.unit || 'some');
  var badge = '';
  if (item.status === 'Running low') badge = '<span class="badge low">low</span>';
  else if (item.status === 'Use soon') badge = '<span class="badge soon">use soon</span>';
  var q = "'";
  if (SELECT_MODE) {
    var checked = SELECTED_IDS[item.id] ? ' checked' : '';
    return '<div class="item selectable" onclick="toggleSelected(' + q + item.id + q + ')">' +
      '<input type="checkbox" class="item-check"' + checked + ' onclick="event.stopPropagation(); toggleSelected(' + q + item.id + q + ')" />' +
      '<div class="info"><div class="name">' + escapeHtml(item.name) + badge + '</div>' +
      '<div class="meta">' + escapeHtml(qty) + '</div></div>' +
      '</div>';
  }
  return '<div class="item">' +
    '<button class="qtybtn" onclick="bump(' + q + item.id + q + ', -1)">−</button>' +
    '<div class="info" onclick="openEdit(' + q + item.id + q + ')"><div class="name">' + escapeHtml(item.name) + badge + '</div>' +
    '<div class="meta">' + escapeHtml(qty) + '</div></div>' +
    '<button class="qtybtn" onclick="bump(' + q + item.id + q + ', 1)">+</button>' +
    '<button class="usedbtn" onclick="useUp(' + q + item.id + q + ')">used up</button>' +
    '</div>';
}

function updateFabVisibility() {
  document.getElementById('addFab').style.display = SELECT_MODE ? 'none' : 'block';
  document.getElementById('bulkBar').style.display = SELECT_MODE ? 'flex' : 'none';
}

function toggleSelectMode() {
  SELECT_MODE = !SELECT_MODE;
  SELECTED_IDS = {};
  document.getElementById('selectToggleBtn').textContent = SELECT_MODE ? 'Cancel' : 'Select';
  document.getElementById('selectAllBtn').style.display = SELECT_MODE ? 'inline-block' : 'none';
  document.getElementById('selectClearBtn').style.display = SELECT_MODE ? 'inline-block' : 'none';
  updateFabVisibility();
  render();
  updateBulkBar();
}

function toggleSelected(id) {
  if (SELECTED_IDS[id]) { delete SELECTED_IDS[id]; } else { SELECTED_IDS[id] = true; }
  render();
  updateBulkBar();
}

function selectAllItems() {
  ITEMS.forEach(function (item) { SELECTED_IDS[item.id] = true; });
  render();
  updateBulkBar();
}

function clearSelection() {
  SELECTED_IDS = {};
  render();
  updateBulkBar();
}

function updateBulkBar() {
  var ids = Object.keys(SELECTED_IDS);
  document.getElementById('bulkCount').textContent = ids.length + (ids.length === 1 ? ' item selected' : ' items selected');
  document.getElementById('bulkRemoveBtn').disabled = ids.length === 0;
}

function bulkDeleteSelected() {
  var ids = Object.keys(SELECTED_IDS);
  if (ids.length === 0) return;
  if (!confirm('Remove ' + ids.length + (ids.length === 1 ? ' item' : ' items') + ' from inventory? This cannot be undone.')) return;
  var btn = document.getElementById('bulkRemoveBtn');
  btn.disabled = true;
  btn.textContent = 'Removing…';
  Promise.all(ids.map(function (id) {
    return apiFetch('/family/api/inventory/' + encodeURIComponent(id), { method: 'DELETE' });
  })).then(function (results) {
    var failedCount = results.filter(function (res) { return !res.body.ok; }).length;
    if (failedCount > 0) {
      alert('Removed ' + (results.length - failedCount) + ' of ' + results.length + ' items — ' + failedCount + ' failed. Select and try again for the rest.');
    }
    SELECTED_IDS = {};
    btn.textContent = 'Remove selected';
    loadInventory();
    updateBulkBar();
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function reportIfFailed(res) {
  if (!res.body.ok) { alert('Could not save: ' + (res.body.error || 'unknown error')); return false; }
  return true;
}

function bump(id, delta) {
  var item = ITEMS.find(function (i) { return i.id === id; });
  if (!item) return;
  var current = typeof item.quantity === 'number' ? item.quantity : 0;
  var next = Math.max(0, current + delta);
  apiFetch('/family/api/inventory/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ quantity: next }) })
    .then(function (res) { if (reportIfFailed(res)) loadInventory(); });
}

function useUp(id) {
  if (!confirm('Mark this as used up and remove it from the list?')) return;
  apiFetch('/family/api/inventory/' + encodeURIComponent(id), { method: 'DELETE' })
    .then(function (res) { if (reportIfFailed(res)) loadInventory(); });
}

function setDialogBusy(busy) {
  document.getElementById('saveBtn').disabled = busy;
  document.getElementById('cancelBtn').disabled = busy;
  var deleteBtn = document.getElementById('deleteBtn');
  if (deleteBtn.style.display !== 'none') deleteBtn.disabled = busy;
}

function openAdd() {
  document.getElementById('dialogTitle').textContent = 'Add food';
  document.getElementById('editId').value = '';
  document.getElementById('editName').value = '';
  document.getElementById('editQty').value = '';
  document.getElementById('editUnit').value = '';
  document.getElementById('editNotes').value = '';
  document.getElementById('deleteBtn').style.display = 'none';
  document.getElementById('saveBtn').textContent = 'Save';
  document.getElementById('deleteBtn').textContent = 'Remove';
  setDialogBusy(false);
  document.getElementById('itemDialog').showModal();
}

function openEdit(id) {
  var item = ITEMS.find(function (i) { return i.id === id; });
  if (!item) return;
  document.getElementById('dialogTitle').textContent = 'Edit food';
  document.getElementById('editId').value = item.id;
  document.getElementById('editName').value = item.name;
  document.getElementById('editQty').value = item.quantity != null ? item.quantity : '';
  document.getElementById('editUnit').value = item.unit || '';
  document.getElementById('editNotes').value = item.notes || '';
  document.getElementById('deleteBtn').style.display = 'block';
  document.getElementById('saveBtn').textContent = 'Save';
  document.getElementById('deleteBtn').textContent = 'Remove';
  setDialogBusy(false);
  document.getElementById('itemDialog').showModal();
}

function closeDialog() {
  PENDING_SHOPPING_RESOLVE_ID = null;
  document.getElementById('itemDialog').close();
}

function saveItem() {
  var id = document.getElementById('editId').value;
  var name = document.getElementById('editName').value.trim();
  if (!name) { alert('Give the food a name.'); return; }
  var qtyRaw = document.getElementById('editQty').value.trim();
  var payload = {
    name: name,
    quantity: qtyRaw === '' ? null : Number(qtyRaw),
    unit: document.getElementById('editUnit').value.trim() || null,
    notes: document.getElementById('editNotes').value.trim() || null,
  };
  setDialogBusy(true);
  document.getElementById('saveBtn').textContent = 'Saving…';
  var req = id
    ? apiFetch('/family/api/inventory/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(payload) })
    : apiFetch('/family/api/inventory', { method: 'POST', body: JSON.stringify(payload) });
  req.then(function (res) {
    if (!reportIfFailed(res)) {
      setDialogBusy(false);
      document.getElementById('saveBtn').textContent = 'Save';
      return;
    }
    var resolveId = PENDING_SHOPPING_RESOLVE_ID;
    PENDING_SHOPPING_RESOLVE_ID = null;
    closeDialog();
    loadInventory();
    if (resolveId) {
      apiFetch('/family/api/shopping-list/' + encodeURIComponent(resolveId), { method: 'PATCH', body: JSON.stringify({ status: 'arrived' }) })
        .then(function () { loadShoppingList(); });
    }
  });
}

function deleteItem() {
  var id = document.getElementById('editId').value;
  if (!id) return;
  if (!confirm('Remove this item entirely?')) return;
  setDialogBusy(true);
  document.getElementById('deleteBtn').textContent = 'Removing…';
  apiFetch('/family/api/inventory/' + encodeURIComponent(id), { method: 'DELETE' })
    .then(function (res) {
      if (reportIfFailed(res)) { closeDialog(); loadInventory(); return; }
      setDialogBusy(false);
      document.getElementById('deleteBtn').textContent = 'Remove';
    });
}

var LAST_MEALS = [];
var LAST_ALMOST = [];
var PENDING_SHOPPING_LIST = [];
var PENDING_SHOPPING_RESOLVE_ID = null;

// Restores whatever plan the household last generated (from this phone or
// any other) so reloading the page doesn't lose it — the plan is a single
// shared record on the server now, not just a page-local variable.
function loadPlan() {
  apiFetch('/family/api/plan-meal').then(function (res) {
    if (!res.body.ok) return;
    var meals = res.body.meals || [];
    var almostMeals = res.body.almostMeals || [];
    if (meals.length === 0 && almostMeals.length === 0 && !res.body.plan) return;
    document.getElementById('planResult').style.display = 'block';
    renderPlan(res.body.plan, meals, almostMeals);
  });
}

function planMeal() {
  var box = document.getElementById('planResult');
  box.style.display = 'block';
  box.innerHTML = '<div class="plan-loading"><div class="spinner"></div><div id="planLoadingText">Working out what you can make…</div></div>';
  var btn = document.getElementById('planBtn');
  btn.disabled = true;
  var notes = document.getElementById('planNotes').value.trim();
  // This call can take 10-20+ seconds, and a static line of text reads as
  // stalled rather than working — count elapsed seconds so it's visibly
  // still going, the same reason a spinner alone isn't quite enough here.
  var seconds = 0;
  var timer = setInterval(function () {
    seconds++;
    var label = document.getElementById('planLoadingText');
    if (label) label.textContent = 'Working out what you can make… ' + seconds + 's';
  }, 1000);
  apiFetch('/family/api/plan-meal', { method: 'POST', body: JSON.stringify({ notes: notes }) }).then(function (res) {
    clearInterval(timer);
    btn.disabled = false;
    if (!res.body.ok) { box.textContent = 'Could not plan right now: ' + (res.body.error || 'unknown error'); return; }
    renderPlan(res.body.plan, res.body.meals || [], res.body.almostMeals || []);
  });
}

function mealPhotoSrc(meal) {
  return '/family/api/meal-image?name=' + encodeURIComponent(photoQueryFor(meal.photoQuery || meal.name)) + '&key=' + encodeURIComponent(FAMILY_KEY);
}

function renderPlan(plan, meals, almostMeals) {
  LAST_MEALS = meals;
  LAST_ALMOST = almostMeals;
  var box = document.getElementById('planResult');
  // The headline count comes from the actual meals array, never from the
  // model's own prose — asking the model to state a count in free text
  // alongside the structured list let the two drift out of sync (prose
  // said "6 dinners", the list came back empty) if it forgot to fill in
  // one of the two. Computing it here makes that contradiction impossible.
  var headline = meals.length === 0
    ? 'No genuine dinners from current stock right now'
    : meals.length + (meals.length === 1 ? ' genuine dinner ready' : ' genuine dinners ready');
  var html = '<div class="plan-headline">' + escapeHtml(headline) + '</div>';
  if (plan) html += '<div class="plan-text">' + escapeHtml(plan) + '</div>';
  if (meals.length === 0) {
    html += '<div class="meal-empty">No ready meals right now — see "Unlock more meals" below, or try Refresh if this looks wrong.</div>';
  } else {
    html += '<div class="meal-carousel">';
    meals.forEach(function (meal, i) {
      html += '<div class="meal-card">';
      html += '<img class="meal-photo" src="' + escapeAttr(mealPhotoSrc(meal)) + '" loading="lazy" alt="" onerror="this.style.display=' + "'none'" + '" />';
      html += '<div class="meal-name">' + escapeHtml(meal.name) + '</div>';
      if (meal.reason) html += '<div class="meal-reason">' + escapeHtml(meal.reason) + '</div>';
      if (meal.usedItems.length > 0) {
        var itemsText = meal.usedItems.map(function (entry) {
          return escapeHtml(entry.name) + ' (' + escapeHtml(String(entry.suggestedRemove)) + (entry.unit ? ' ' + escapeHtml(entry.unit) : '') + ')';
        }).join(', ');
        html += '<div class="meal-items">Uses: ' + itemsText + '</div>';
        html += '<button class="cook-btn" id="cookBtn-' + i + '" onclick="applyUsedItems(' + i + ')">Cooked it → remove from inventory</button>';
      }
      html += '</div>';
    });
    html += '</div>';
  }
  if (almostMeals.length > 0) {
    html += '<div class="almost-heading">Unlock more meals — just a few items away</div>';
    html += '<div class="meal-carousel">';
    almostMeals.forEach(function (meal, i) {
      var missingText = meal.missing.map(function (m) {
        return escapeHtml(m.item) + (m.quantity ? ' (' + escapeHtml(m.quantity) + ')' : '');
      }).join(', ');
      html += '<div class="meal-card locked" id="' + escapeAttr(mealAnchorId(meal.name)) + '">';
      html += '<img class="meal-photo" src="' + escapeAttr(mealPhotoSrc(meal)) + '" loading="lazy" alt="" onerror="this.style.display=' + "'none'" + '" />';
      html += '<div class="meal-name">' + escapeHtml(meal.name) + '</div>';
      if (meal.reason) html += '<div class="meal-reason">' + escapeHtml(meal.reason) + '</div>';
      html += '<div class="meal-missing">Needs: ' + missingText + '</div>';
      html += '<button class="unlock-btn" id="unlockBtn-' + i + '" onclick="unlockMeal(' + i + ')">Add to list</button>';
      html += '</div>';
    });
    html += '</div>';
  }
  html += '<button class="plan-refresh" onclick="planMeal()">Refresh</button>';
  box.innerHTML = html;
}

function unlockMeal(index) {
  var meal = LAST_ALMOST[index];
  if (!meal) return;
  var btn = document.getElementById('unlockBtn-' + index);
  if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
  apiFetch('/family/api/shopping-list/unlock', { method: 'POST', body: JSON.stringify({ meal: meal.name, items: meal.missing }) })
    .then(function (res) {
      if (!res.body.ok) {
        if (btn) { btn.disabled = false; btn.textContent = 'Add to list'; }
        reportIfFailed(res);
        return;
      }
      if (btn) btn.textContent = '✓ Added';
      loadShoppingList();
    });
}

function escapeAttr(s) { return String(s).replace(/"/g, '&quot;'); }

// A stable anchor id for a locked (almost-there) meal's card, so the
// matching group in "What you'll need" can link straight back to it
// instead of duplicating its photo — a plain in-page #anchor link, with no
// JS needed to find the element and no error if it isn't on the page right
// now (e.g. the plan's since been refreshed).
function mealAnchorId(name) {
  return 'almostMeal-' + String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// A meal's display name is often a compound description ("Chicken and bacon
// pies with mash and peas") that a stock-photo search matches poorly or not
// at all — Pixabay does far better on the core dish ("Chicken and bacon
// pies"). Searching on just the part before "with" strips the side/garnish
// clause without needing another AI call for a cosmetic lookup.
function photoQueryFor(name) {
  var core = name.replace(/\\s+with\\s+.*$/i, '').trim();
  return core || name;
}

function loadShoppingList() {
  apiFetch('/family/api/shopping-list').then(function (res) {
    if (!res.body.ok) return;
    renderShoppingList(res.body.items || []);
  });
}

function renderShoppingList(items) {
  PENDING_SHOPPING_LIST = items;
  var wrapper = document.getElementById('shoppingDetails');
  var section = document.getElementById('shoppingListSection');
  if (!items || items.length === 0) {
    wrapper.style.display = 'none';
    section.innerHTML = '';
    return;
  }
  wrapper.style.display = 'block';
  document.getElementById('shopCount').textContent = items.length + (items.length === 1 ? ' item' : ' items') + ' waiting';

  // Group by the meal each item would unlock (not just a flat ingredient
  // dump) so it's clear why something's on the list. Bucketed rather than
  // relying on adjacent rows sharing a meal, since items for the same meal
  // can land apart in insertion order across separate planning sessions.
  var groups = [];
  var groupByLabel = {};
  items.forEach(function (entry) {
    var label = entry.meal || 'Other';
    if (!groupByLabel[label]) {
      groupByLabel[label] = [];
      groups.push({ label: label, entries: groupByLabel[label] });
    }
    groupByLabel[label].push(entry);
  });

  var q = "'";
  var html = '';
  groups.forEach(function (group) {
    html += '<div class="shop-meal-group"><span class="cat-heading">' + escapeHtml(group.label) + '</span>';
    if (group.label !== 'Other') {
      html += '<a class="shop-meal-link" href="#' + escapeAttr(mealAnchorId(group.label)) + '">View meal ↑</a>';
    }
    html += '</div>';
    group.entries.forEach(function (entry) {
      var href = entry.directUrl || entry.searchUrl;
      var label = entry.directUrl ? 'Open on Tesco' : 'Search on Tesco';
      html += '<div class="shop-item">' +
        '<div class="shop-info"><div class="shop-name">' + escapeHtml(entry.item) + '</div>' +
        (entry.quantity ? '<div class="shop-qty">' + escapeHtml(entry.quantity) + '</div>' : '') +
        '</div>' +
        '<a class="shop-link" href="' + escapeAttr(href) + '" target="_blank" rel="noopener">' + label + '</a>' +
        '<button class="shop-add" onclick="arrivedFromShoppingList(' + q + entry.id + q + ')">Arrived</button>' +
        '<button class="shop-cancel" onclick="cancelShoppingListItem(' + q + entry.id + q + ')">Not getting this</button>' +
        '</div>';
    });
  });
  section.innerHTML = html;
}

function arrivedFromShoppingList(id) {
  var entry = PENDING_SHOPPING_LIST.find(function (e) { return e.id === id; });
  if (!entry) return;
  PENDING_SHOPPING_RESOLVE_ID = id;
  openAdd();
  document.getElementById('editName').value = entry.item;
}

function cancelShoppingListItem(id) {
  if (!confirm('Not getting this one — drop it from the shopping list?')) return;
  apiFetch('/family/api/shopping-list/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) })
    .then(function (res) { if (reportIfFailed(res)) loadShoppingList(); });
}

function applyUsedItems(index) {
  var meal = LAST_MEALS[index];
  if (!meal || meal.usedItems.length === 0) return;
  var btn = document.getElementById('cookBtn-' + index);
  if (btn) { btn.disabled = true; btn.textContent = 'Updating inventory…'; }
  // Goes through the shared plan on the server (by meal name, not this
  // tab's array position) rather than patching each item to a quantity
  // computed from numbers captured when the plan was generated — those can
  // be stale by the time you actually cook, especially since the plan can
  // now sit around for hours and be acted on from any phone in the house.
  apiFetch('/family/api/plan-meal/cook', { method: 'POST', body: JSON.stringify({ mealName: meal.name }) }).then(function (res) {
    if (!res.body.ok) {
      alert((res.body.error || 'Could not update inventory') + ' Refreshing the plan.');
      if (btn) { btn.disabled = false; btn.textContent = 'Cooked it → remove from inventory'; }
      loadPlan();
      return;
    }
    meal.usedItems = [];
    if (btn) { btn.textContent = 'Done — inventory updated'; }
    loadInventory();
  });
}

boot();
</script>
</body>
</html>
`;
