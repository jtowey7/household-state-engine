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
<style>
  :root { color-scheme: light dark; }
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
  .plan-row { display: flex; gap: 8px; margin-bottom: 16px; }
  .plan-row button {
    flex: 1; padding: 14px 8px; border-radius: 12px; border: none;
    background: #2f6f4f; color: #fff; font-size: 14px; font-weight: 600;
  }
  .plan-row button.secondary { background: #4a5b8c; }
  #planResult {
    display: none; background: #fff; border-radius: 12px; padding: 14px;
    margin-bottom: 16px; font-size: 14px; line-height: 1.5;
    border: 1px solid #e3e1da;
  }
  #planResult .plan-text { white-space: pre-wrap; }
  .shopping-list { margin-top: 14px; border-top: 1px solid #e3e1da; padding-top: 12px; }
  .shopping-list h3 { margin: 0 0 8px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: #6b6a63; }
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
  .fab {
    position: fixed; bottom: 16px; left: 16px; right: 16px; max-width: 608px; margin: 0 auto;
    padding: 16px; border-radius: 14px; border: none; background: #1c1b19; color: #fff;
    font-size: 15px; font-weight: 700;
  }
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
    .item, #planResult { background: #211f18; border-color: #332f23; }
    .qtybtn, .usedbtn, .shop-add { background: #2a2820; border-color: #3a362a; color: #f1efe9; }
    .sheet input, .sheet select, .sheet textarea { background: #211f18; border-color: #3a362a; color: #f1efe9; }
    .sheet .actions .cancel { background: #2a2820; color: #f1efe9; }
    .shopping-list { border-color: #332f23; }
    .shop-item { border-color: #2a2820; }
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
    <div class="plan-row">
      <button onclick="planMeal('today')">What's for dinner?</button>
      <button class="secondary" onclick="planMeal('week')">Plan the week</button>
    </div>
    <div id="planResult"></div>
    <div id="list"></div>
  </div>
</main>
<button class="fab" id="addFab" style="display:none" onclick="openAdd()">+ Add food</button>

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
      <button class="cancel" onclick="closeDialog()">Cancel</button>
      <button class="delete" id="deleteBtn" style="display:none" onclick="deleteItem()">Remove</button>
      <button class="save" onclick="saveItem()">Save</button>
    </div>
  </div>
</dialog>

<script>
let FAMILY_KEY = localStorage.getItem('familyKey') || '';
let ITEMS = [];

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
    document.getElementById('addFab').style.display = 'block';
    ITEMS = res.body.items || [];
    render();
  });
}

function render() {
  var html = '';
  if (ITEMS.length === 0) {
    html = '<div class="empty">Nothing logged yet. Tap "Add food" to start.</div>';
  } else {
    ITEMS.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (item) {
      html += renderItem(item);
    });
  }
  document.getElementById('list').innerHTML = html;
}

function renderItem(item) {
  var qty = item.quantity != null ? (item.quantity + (item.unit ? ' ' + item.unit : '')) : (item.unit || 'some');
  var badge = '';
  if (item.status === 'Running low') badge = '<span class="badge low">low</span>';
  else if (item.status === 'Use soon') badge = '<span class="badge soon">use soon</span>';
  var q = "'";
  return '<div class="item">' +
    '<button class="qtybtn" onclick="bump(' + q + item.id + q + ', -1)">−</button>' +
    '<div class="info" onclick="openEdit(' + q + item.id + q + ')"><div class="name">' + escapeHtml(item.name) + badge + '</div>' +
    '<div class="meta">' + escapeHtml(qty) + '</div></div>' +
    '<button class="qtybtn" onclick="bump(' + q + item.id + q + ', 1)">+</button>' +
    '<button class="usedbtn" onclick="useUp(' + q + item.id + q + ')">used up</button>' +
    '</div>';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function reportIfFailed(res) {
  if (!res.body.ok) { alert('That didn\'t save: ' + (res.body.error || 'unknown error')); return false; }
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

function openAdd() {
  document.getElementById('dialogTitle').textContent = 'Add food';
  document.getElementById('editId').value = '';
  document.getElementById('editName').value = '';
  document.getElementById('editQty').value = '';
  document.getElementById('editUnit').value = '';
  document.getElementById('editNotes').value = '';
  document.getElementById('deleteBtn').style.display = 'none';
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
  document.getElementById('itemDialog').showModal();
}

function closeDialog() { document.getElementById('itemDialog').close(); }

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
  var req = id
    ? apiFetch('/family/api/inventory/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(payload) })
    : apiFetch('/family/api/inventory', { method: 'POST', body: JSON.stringify(payload) });
  req.then(function (res) { if (reportIfFailed(res)) { closeDialog(); loadInventory(); } });
}

function deleteItem() {
  var id = document.getElementById('editId').value;
  if (!id) return;
  if (!confirm('Remove this item entirely?')) return;
  apiFetch('/family/api/inventory/' + encodeURIComponent(id), { method: 'DELETE' })
    .then(function (res) { if (reportIfFailed(res)) { closeDialog(); loadInventory(); } });
}

var LAST_SHOPPING_LIST = [];

function planMeal(mode) {
  var box = document.getElementById('planResult');
  box.style.display = 'block';
  box.innerHTML = '';
  box.textContent = mode === 'today' ? 'Thinking about tonight…' : 'Planning the week…';
  apiFetch('/family/api/plan-meal', { method: 'POST', body: JSON.stringify({ mode: mode }) }).then(function (res) {
    if (!res.body.ok) { box.textContent = 'Could not plan right now: ' + (res.body.error || 'unknown error'); return; }
    renderPlan(res.body.plan, res.body.shoppingList || []);
  });
}

function renderPlan(plan, shoppingList) {
  LAST_SHOPPING_LIST = shoppingList;
  var box = document.getElementById('planResult');
  var html = '<div class="plan-text">' + escapeHtml(plan) + '</div>';
  if (shoppingList.length > 0) {
    html += '<div class="shopping-list"><h3>Shopping list</h3>';
    shoppingList.forEach(function (entry, i) {
      var href = entry.directUrl || entry.searchUrl;
      var label = entry.directUrl ? 'Open on Tesco' : 'Search on Tesco';
      html += '<div class="shop-item">' +
        '<div class="shop-info"><div class="shop-name">' + escapeHtml(entry.item) + '</div>' +
        (entry.quantity ? '<div class="shop-qty">' + escapeHtml(entry.quantity) + '</div>' : '') +
        '</div>' +
        '<a class="shop-link" href="' + escapeAttr(href) + '" target="_blank" rel="noopener">' + label + '</a>' +
        '<button class="shop-add" onclick="addFromShoppingList(' + i + ')">Arrived → add</button>' +
        '</div>';
    });
    html += '</div>';
  }
  box.innerHTML = html;
}

function escapeAttr(s) { return String(s).replace(/"/g, '&quot;'); }

function addFromShoppingList(index) {
  var entry = LAST_SHOPPING_LIST[index];
  if (!entry) return;
  openAdd();
  document.getElementById('editName').value = entry.item;
}

boot();
</script>
</body>
</html>
`;
