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
<script id="theme-init">
  // Applied before the stylesheet renders anything, so an explicit
  // light/dark choice (see toggleTheme in the main script below) takes
  // effect immediately on load instead of flashing the system-default
  // theme first. "Auto" (no stored choice) sets nothing here and just
  // falls through to the @media (prefers-color-scheme) rules below.
  (function () {
    try {
      var t = localStorage.getItem('theme');
      if (t === 'light' || t === 'dark') {
        document.documentElement.setAttribute('data-theme', t);
        document.documentElement.style.colorScheme = t;
      }
    } catch (e) {}
  })();
</script>
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
  .stock-strip {
    display: block; width: 100%; margin: 10px 0 0; padding: 9px 12px;
    border-radius: 9px; border: none; background: rgba(255,255,255,0.1);
    color: #fff; font-size: 12.5px; font-weight: 600; text-align: left;
    -webkit-tap-highlight-color: transparent;
  }
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
  dialog.full-sheet { width: min(640px, 94vw); max-height: 86vh; padding: 0; }
  dialog.full-sheet[open] { display: flex; flex-direction: column; }
  .full-sheet-body { padding: 18px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; min-height: 0; }
  .full-sheet-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
  .full-sheet-head h3 { margin: 0; font-size: 16px; display: flex; align-items: center; gap: 8px; }
  .dialog-close {
    border: none; background: #f7f6f3; width: 32px; height: 32px; border-radius: 8px;
    font-size: 15px; color: #6b6a63; flex-shrink: 0; -webkit-tap-highlight-color: transparent;
  }
  .cat-heading {
    font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
    color: #6b6a63; margin: 14px 0 6px;
  }
  .cat-heading:first-child { margin-top: 0; }
  .shop-meal-group { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin: 14px 0 6px; }
  .shop-meal-group:first-child { margin-top: 0; }
  .shop-meal-group .cat-heading { margin: 0; }
  .shop-meal-link { font-size: 12px; font-weight: 600; color: #2f6f4f; text-decoration: none; white-space: nowrap; }
  .plan-hint, .section-hint { font-size: 11.5px; color: #9a988f; margin: 0 0 10px; line-height: 1.4; }
  .plan-btn {
    width: 100%; padding: 14px 8px; border-radius: 12px; border: none;
    background: #2f6f4f; color: #fff; font-size: 15px; font-weight: 700; margin-bottom: 8px;
  }
  .toolbar-row { display: flex; gap: 8px; margin-bottom: 16px; }
  .toolbar-link {
    flex: 1; padding: 9px 4px; border-radius: 10px; border: 1px solid #e3e1da;
    background: #fff; color: #3d3c37; font-size: 11.5px; font-weight: 600; text-align: center;
    -webkit-tap-highlight-color: transparent;
  }
  .settings-row {
    display: block; width: 100%; text-align: left; padding: 12px 4px; margin: 0;
    background: none; border: none; color: #1c1b19; font-size: 14px; font-weight: 600;
    -webkit-tap-highlight-color: transparent;
  }
  .settings-divider { height: 1px; background: #e3e1da; margin: 2px 0; }
  #planResult { display: none; margin-bottom: 16px; }
  .plan-loading, .plan-loading-banner {
    display: flex; align-items: center; gap: 10px; padding: 14px; font-size: 14px;
    color: #3d3c37; background: #fff; border: 1px solid #e3e1da; border-radius: 12px;
  }
  .plan-loading-banner { padding: 10px 14px; font-size: 13px; margin-bottom: 10px; }
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
    background: #fff; border-radius: 12px; padding: 14px;
    border: 1px solid #e3e1da; flex: 0 0 82%; scroll-snap-align: start;
    box-shadow: 0 1px 3px rgba(28,27,25,0.05);
  }
  .meal-head { display: flex; align-items: flex-start; gap: 10px; }
  .meal-icon {
    width: 42px; height: 42px; border-radius: 11px; flex-shrink: 0;
    background: #efeee8; display: flex; align-items: center; justify-content: center;
    font-size: 21px;
  }
  .meal-head-text { flex: 1; min-width: 0; }
  .meal-name { font-size: 15px; font-weight: 700; line-height: 1.3; }
  .meal-reason { font-size: 12.5px; color: #6b6a63; margin-top: 2px; }
  .meal-effort {
    display: inline-block; font-size: 11px; font-weight: 600; color: #6b6a63;
    background: #f1efe9; padding: 3px 8px; border-radius: 999px; margin-top: 8px;
  }
  .meal-items { font-size: 12.5px; color: #6b6a63; margin-top: 8px; line-height: 1.5; }
  .meal-notes {
    font-size: 12.5px; color: #2f6f4f; background: #e6f2ec; padding: 6px 8px;
    border-radius: 8px; margin-top: 8px; line-height: 1.4;
  }
  .favorite-btn {
    display: block; width: 100%; margin-top: 8px; padding: 9px; border-radius: 10px;
    border: 1px solid #ddd; background: none; color: #6b6a63; font-size: 12.5px; font-weight: 600;
  }
  .more-card {
    display: flex; align-items: center; justify-content: center; cursor: pointer;
    -webkit-tap-highlight-color: transparent; min-height: 96px;
  }
  .more-card-inner { text-align: center; color: #6b6a63; font-size: 13px; font-weight: 600; }
  .more-icon { font-size: 26px; line-height: 1; margin-bottom: 4px; color: #9a988f; }
  .plan-note {
    font-size: 12.5px; color: #6b6a63; background: #f1efe9; border-radius: 8px;
    padding: 8px 10px; margin-bottom: 10px;
  }
  .debug-block {
    margin-top: 12px; background: #fdf6e3; border: 1px solid #e8dfc0; border-radius: 10px;
    padding: 10px 12px; font-size: 12px;
  }
  .debug-block summary { cursor: pointer; font-weight: 700; color: #6b5a1e; -webkit-tap-highlight-color: transparent; }
  .debug-block .debug-label { font-weight: 700; font-size: 11px; color: #6b5a1e; margin-top: 8px; }
  .debug-block pre {
    white-space: pre-wrap; word-break: break-word; font-size: 11px; background: #fff;
    border-radius: 6px; padding: 8px; margin: 4px 0 0; max-height: 200px; overflow-y: auto;
  }
  .meal-empty {
    background: #fff; border-radius: 12px; padding: 14px; border: 1px solid #e3e1da;
    font-size: 14px; color: #6b6a63; margin-bottom: 10px;
  }
  .almost-heading {
    font-size: 13px; font-weight: 700; color: #6b6a63; margin: 4px 0 8px;
  }
  .meal-card.locked { opacity: 0.72; }
  .meal-card.selected { opacity: 1; border: 2px solid #2f6f4f; }
  .meal-missing { font-size: 12.5px; color: #a3401a; margin-top: 8px; line-height: 1.5; font-weight: 600; }
  .selected-badge {
    display: inline-block; font-size: 12px; font-weight: 700; color: #2f6f4f;
    background: #e6f2ec; padding: 3px 9px; border-radius: 999px; margin-top: 8px;
  }
  .shop-list-link {
    display: block; font-size: 12.5px; font-weight: 600; color: #2f6f4f;
    text-decoration: none; margin-top: 8px;
  }
  .unlock-btn {
    width: 100%; margin-top: 10px; padding: 11px; border-radius: 10px;
    border: 1px solid #2f6f4f; background: none; color: #2f6f4f; font-size: 13px; font-weight: 700;
  }
  .unlock-btn:disabled { opacity: 0.6; }
  .dismiss-btn {
    display: block; width: 100%; margin-top: 6px; padding: 4px; border: none;
    background: none; color: #9a988f; font-size: 12px; font-weight: 600; text-decoration: underline;
  }
  .stepper { display: flex; align-items: center; gap: 14px; margin-bottom: 4px; }
  .stepper-btn {
    width: 38px; height: 38px; border-radius: 10px; border: 1px solid #ddd;
    background: #f7f6f3; font-size: 18px; line-height: 1; flex-shrink: 0;
  }
  .stepper-value { font-size: 16px; font-weight: 700; min-width: 24px; text-align: center; }
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
    position: sticky; bottom: 0; margin-top: 10px;
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
    html:not([data-theme="light"]) body { background: #15140f; color: #f1efe9; }
    html:not([data-theme="light"]) .item, html:not([data-theme="light"]) .meal-card, html:not([data-theme="light"]) .meal-empty, html:not([data-theme="light"]) .plan-loading, html:not([data-theme="light"]) .plan-loading-banner { background: #211f18; border-color: #332f23; color: #f1efe9; }
    html:not([data-theme="light"]) .toolbar-link { background: #211f18; border-color: #332f23; color: #f1efe9; }
    html:not([data-theme="light"]) .settings-divider { background: #332f23; }
    html:not([data-theme="light"]) .settings-row { color: #f1efe9; }
    html:not([data-theme="light"]) .meal-notes { background: #1d3229; color: #bfe3cd; }
    html:not([data-theme="light"]) .favorite-btn { border-color: #3a362a; color: #d7d5cc; }
    html:not([data-theme="light"]) .spinner { border-color: #3a362a; border-top-color: #2f6f4f; }
    html:not([data-theme="light"]) .meal-icon { background: #2a2820; }
    html:not([data-theme="light"]) .meal-card { box-shadow: none; }
    html:not([data-theme="light"]) .qtybtn, html:not([data-theme="light"]) .usedbtn, html:not([data-theme="light"]) .shop-add, html:not([data-theme="light"]) .shop-cancel, html:not([data-theme="light"]) .select-toggle, html:not([data-theme="light"]) .select-all-btn, html:not([data-theme="light"]) .select-clear-btn, html:not([data-theme="light"]) .stepper-btn { background: #2a2820; border-color: #3a362a; color: #f1efe9; }
    html:not([data-theme="light"]) .sheet input, html:not([data-theme="light"]) .sheet select, html:not([data-theme="light"]) .sheet textarea { background: #211f18; border-color: #3a362a; color: #f1efe9; }
    html:not([data-theme="light"]) .sheet .actions .cancel { background: #2a2820; color: #f1efe9; }
    html:not([data-theme="light"]) .shop-item { border-color: #2a2820; }
    html:not([data-theme="light"]) #shoppingListSection { background: #211f18; border-color: #332f23; }
    html:not([data-theme="light"]) details.section summary { background: #211f18; border-color: #332f23; color: #f1efe9; }
    html:not([data-theme="light"]) details.section summary:active { background: #2a2820; }
    html:not([data-theme="light"]) #planResult .plan-text { color: #d7d5cc; }
    html:not([data-theme="light"]) .selected-badge { background: #1d3229; }
    html:not([data-theme="light"]) dialog.full-sheet { background: #211f18; color: #f1efe9; }
    html:not([data-theme="light"]) .dialog-close { background: #2a2820; color: #d7d5cc; }
    html:not([data-theme="light"]) .meal-effort { background: #2a2820; color: #d7d5cc; }
    html:not([data-theme="light"]) .more-card-inner, html:not([data-theme="light"]) .more-icon { color: #9a988f; }
    html:not([data-theme="light"]) .plan-note { background: #211f18; color: #d7d5cc; }
    html:not([data-theme="light"]) .debug-block { background: #2a2416; border-color: #4a3f22; }
    html:not([data-theme="light"]) .debug-block summary, html:not([data-theme="light"]) .debug-block .debug-label { color: #d9c37a; }
    html:not([data-theme="light"]) .debug-block pre { background: #15140f; color: #d7d5cc; }
  }
  html[data-theme="dark"] body { background: #15140f; color: #f1efe9; }
  html[data-theme="dark"] .item, html[data-theme="dark"] .meal-card, html[data-theme="dark"] .meal-empty, html[data-theme="dark"] .plan-loading, html[data-theme="dark"] .plan-loading-banner { background: #211f18; border-color: #332f23; color: #f1efe9; }
  html[data-theme="dark"] .toolbar-link { background: #211f18; border-color: #332f23; color: #f1efe9; }
  html[data-theme="dark"] .settings-divider { background: #332f23; }
  html[data-theme="dark"] .settings-row { color: #f1efe9; }
  html[data-theme="dark"] .meal-notes { background: #1d3229; color: #bfe3cd; }
  html[data-theme="dark"] .favorite-btn { border-color: #3a362a; color: #d7d5cc; }
  html[data-theme="dark"] .spinner { border-color: #3a362a; border-top-color: #2f6f4f; }
  html[data-theme="dark"] .meal-icon { background: #2a2820; }
  html[data-theme="dark"] .meal-card { box-shadow: none; }
  html[data-theme="dark"] .qtybtn, html[data-theme="dark"] .usedbtn, html[data-theme="dark"] .shop-add, html[data-theme="dark"] .shop-cancel, html[data-theme="dark"] .select-toggle, html[data-theme="dark"] .select-all-btn, html[data-theme="dark"] .select-clear-btn, html[data-theme="dark"] .stepper-btn { background: #2a2820; border-color: #3a362a; color: #f1efe9; }
  html[data-theme="dark"] .sheet input, html[data-theme="dark"] .sheet select, html[data-theme="dark"] .sheet textarea { background: #211f18; border-color: #3a362a; color: #f1efe9; }
  html[data-theme="dark"] .sheet .actions .cancel { background: #2a2820; color: #f1efe9; }
  html[data-theme="dark"] .shop-item { border-color: #2a2820; }
  html[data-theme="dark"] #shoppingListSection { background: #211f18; border-color: #332f23; }
  html[data-theme="dark"] details.section summary { background: #211f18; border-color: #332f23; color: #f1efe9; }
  html[data-theme="dark"] details.section summary:active { background: #2a2820; }
  html[data-theme="dark"] #planResult .plan-text { color: #d7d5cc; }
  html[data-theme="dark"] .selected-badge { background: #1d3229; }
  html[data-theme="dark"] dialog.full-sheet { background: #211f18; color: #f1efe9; }
  html[data-theme="dark"] .dialog-close { background: #2a2820; color: #d7d5cc; }
  html[data-theme="dark"] .meal-effort { background: #2a2820; color: #d7d5cc; }
  html[data-theme="dark"] .more-card-inner, html[data-theme="dark"] .more-icon { color: #9a988f; }
  html[data-theme="dark"] .plan-note { background: #211f18; color: #d7d5cc; }
  html[data-theme="dark"] .debug-block { background: #2a2416; border-color: #4a3f22; }
  html[data-theme="dark"] .debug-block summary, html[data-theme="dark"] .debug-block .debug-label { color: #d9c37a; }
  html[data-theme="dark"] .debug-block pre { background: #15140f; color: #d7d5cc; }
</style>
</head>
<body>
<header>
  <h1>Our Food</h1>
  <p id="subtitle">What's actually in the house</p>
  <button class="stock-strip" id="stockStrip" onclick="openInventory()">Loading stock…</button>
</header>
<main>
  <div id="keygate" class="keygate" style="display:none">
    <p>Enter the family key to open the list (you only need to do this once per device).</p>
    <input id="keyInput" type="text" placeholder="family key" autocapitalize="off" autocorrect="off" />
    <button onclick="saveKey()">Open</button>
  </div>
  <div id="app" style="display:none">
    <div class="section-hint">Based on what's in the house — built entirely from stock.</div>
    <button class="plan-btn" id="planBtn" onclick="planMeal()">What can we eat?</button>
    <div class="toolbar-row">
      <button class="toolbar-link" id="tonightBtn" onclick="openTonight()">🍽️ Tonight</button>
      <button class="toolbar-link" id="favoritesBtn" onclick="openFavorites()">⭐ Favorites</button>
      <button class="toolbar-link" id="settingsBtn" onclick="openSettings()">⚙ Settings</button>
    </div>
    <div id="planResult"></div>

    <details class="section" id="shoppingDetails" style="display:none">
      <summary><span>Shopping list</span><span class="section-count" id="shopCount"></span></summary>
      <div class="section-hint">Things you've chosen to buy to unlock more meals — pick them from the "Unlock more meals" row above after tapping "What can we eat?".</div>
      <div id="shoppingListSection"></div>
    </details>
  </div>
</main>

<dialog id="inventoryDialog" class="full-sheet">
  <div class="sheet full-sheet-body">
    <div class="full-sheet-head">
      <h3>What's in the house <span class="section-count" id="invCount"></span></h3>
      <button class="dialog-close" onclick="closeInventory()" aria-label="Close">✕</button>
    </div>
    <div class="section-hint">Everything currently logged. Tap an item to adjust it, or log something new.</div>
    <div class="list-toolbar">
      <button class="select-toggle" id="selectToggleBtn" onclick="toggleSelectMode()">Select</button>
      <button class="select-all-btn" id="selectAllBtn" onclick="selectAllItems()" style="display:none">Select all</button>
      <button class="select-clear-btn" id="selectClearBtn" onclick="clearSelection()" style="display:none">Clear</button>
      <button class="add-food-btn" id="addFab" onclick="openAdd()">+ Add food</button>
    </div>
    <div id="list"></div>
    <div class="bulk-bar" id="bulkBar">
      <span id="bulkCount">0 selected</span>
      <button class="bulk-remove" id="bulkRemoveBtn" onclick="bulkDeleteSelected()" disabled>Remove selected</button>
    </div>
  </div>
</dialog>

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

<dialog id="tonightDialog">
  <div class="sheet">
    <h3>Just for tonight</h3>
    <label>One-off note (optional)</label>
    <textarea id="planNotes" rows="3" placeholder="e.g. 7 of us, or no veggie needed"></textarea>
    <div class="section-hint">Used for your next suggestion only — household defaults above stay as they are.</div>
    <div class="actions">
      <button class="cancel" onclick="closeTonight()">Cancel</button>
      <button class="save" onclick="saveTonight()">Save</button>
    </div>
  </div>
</dialog>

<dialog id="settingsDialog">
  <div class="sheet">
    <h3>Settings</h3>
    <button class="settings-row" onclick="closeSettings(); openPrefs();">⚙ Household defaults</button>
    <div class="settings-divider"></div>
    <button class="settings-row" id="themeToggleBtn" onclick="cycleTheme()">🌓 Theme: Auto</button>
    <div class="settings-divider"></div>
    <button class="settings-row" id="debugToggleBtn" onclick="toggleDebugMode()">🔧 Show AI details: Off</button>
    <div class="section-hint">Shows the exact prompt sent to and received from the AI, right here, the next time you tap "What can we eat?", dismiss a card, or "More options" — nothing is sent anywhere else, it's just for checking a surprising suggestion.</div>
    <div id="settingsDebugPanel"></div>
    <div class="actions">
      <button class="cancel" onclick="closeSettings()">Close</button>
    </div>
  </div>
</dialog>

<dialog id="favoritesDialog" class="full-sheet">
  <div class="sheet full-sheet-body">
    <div class="full-sheet-head">
      <h3>⭐ Favorites</h3>
      <button class="dialog-close" onclick="closeFavorites()" aria-label="Close">✕</button>
    </div>
    <div class="section-hint">Your own customized versions of meals, saved from a meal card's "Save as favorite" button. Adding one here drops it straight onto your ready meals — made your way, with no AI call.</div>
    <div id="favoritesList"></div>
  </div>
</dialog>

<dialog id="favoriteDialog">
  <div class="sheet">
    <h3 id="favoriteDialogTitle">Save as favorite</h3>
    <input type="hidden" id="favoriteEditId" />
    <label>Name</label>
    <input id="favoriteName" placeholder="e.g. Spaghetti carbonara" />
    <label>How you actually make it</label>
    <textarea id="favoriteNotes" rows="3" placeholder="e.g. cheddar and egg, not cream or parmesan — a splash of pasta water"></textarea>
    <label>Effort</label>
    <select id="favoriteEffort">
      <option value="quick">⚡ Quick</option>
      <option value="moderate">🕐 Moderate</option>
      <option value="slow">🐢 Slow cook</option>
    </select>
    <div class="actions">
      <button class="cancel" onclick="closeFavoriteEditor()">Cancel</button>
      <button class="delete" id="favoriteDeleteBtn" style="display:none" onclick="deleteFavoriteFromEditor()">Remove</button>
      <button class="save" onclick="saveFavoriteEditor()">Save</button>
    </div>
  </div>
</dialog>

<script>
let FAMILY_KEY = localStorage.getItem('familyKey') || '';
let ITEMS = [];
var SELECT_MODE = false;
var SELECTED_IDS = {};
// UAT aid: surfaces exactly what was sent to and received from the model
// for the most recent plan/replace call, so a surprising suggestion can be
// diagnosed from the real prompt instead of guessed at. Off by default,
// persisted per-device since it's a testing toggle, not a household setting.
var DEBUG_MODE = localStorage.getItem('aiDebugMode') === 'true';
var LAST_DEBUG = null;

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
wireCollapsible('shoppingDetails', 'shopSectionOpen', true);

function updateDebugToggleLabel() {
  var btn = document.getElementById('debugToggleBtn');
  if (btn) btn.textContent = '🔧 Show AI details: ' + (DEBUG_MODE ? 'On' : 'Off');
}
updateDebugToggleLabel();

function toggleDebugMode() {
  DEBUG_MODE = !DEBUG_MODE;
  try { localStorage.setItem('aiDebugMode', DEBUG_MODE ? 'true' : 'false'); } catch (e) {}
  updateDebugToggleLabel();
  // Flipping the toggle used to change nothing visible until the next AI
  // call happened to run — which read as "this doesn't seem to do
  // anything". Update the panel (right here in Settings, next to the
  // toggle — a normal user who never turns this on should never see it in
  // the main plan view) immediately so it, or its placeholder explaining
  // there's nothing captured yet, appears right away.
  updateSettingsDebugPanel();
}

// 'auto' follows the system — the default, and what every visit gets until
// someone explicitly picks a side via the Settings toggle. 'light'/'dark'
// are stored per-device and applied immediately on the next load (see the
// early inline script in <head>, which prevents a flash of the wrong theme
// before this script runs).
function currentTheme() {
  try {
    var t = localStorage.getItem('theme');
    return (t === 'light' || t === 'dark') ? t : 'auto';
  } catch (e) { return 'auto'; }
}

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
  } else {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = 'light dark';
  }
  var btn = document.getElementById('themeToggleBtn');
  if (btn) btn.textContent = '🌓 Theme: ' + (theme === 'light' ? 'Light' : theme === 'dark' ? 'Dark' : 'Auto');
}
applyTheme(currentTheme());

function cycleTheme() {
  var order = ['auto', 'light', 'dark'];
  var next = order[(order.indexOf(currentTheme()) + 1) % order.length];
  try { localStorage.setItem('theme', next); } catch (e) {}
  applyTheme(next);
}

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

// "Just for tonight" used to be a permanently visible text input on the
// main screen — tucked into a dialog instead, like household defaults, so
// the main view isn't cluttered with an input most visits don't need.
// #planNotes itself lives inside this dialog; every other call site reads
// its .value directly, which still works whether the dialog is open or
// closed since closing a <dialog> doesn't clear its contents — only
// SAVED_TONIGHT_NOTE decides what a Cancel reverts back to.
var SAVED_TONIGHT_NOTE = '';

// Kept short (it lives in the compact toolbar row now, alongside Favorites
// and Settings, not a full-width button) — a dot shows a note is set rather
// than trying to fit the note text itself in, with the full text still
// readable as a title tooltip and, properly, inside the dialog on open.
function updateTonightButtonLabel() {
  var btn = document.getElementById('tonightBtn');
  if (!btn) return;
  btn.textContent = SAVED_TONIGHT_NOTE ? '🍽️ Tonight •' : '🍽️ Tonight';
  btn.title = SAVED_TONIGHT_NOTE || '';
}

function openTonight() {
  document.getElementById('planNotes').value = SAVED_TONIGHT_NOTE;
  document.getElementById('tonightDialog').showModal();
}

function closeTonight() {
  document.getElementById('planNotes').value = SAVED_TONIGHT_NOTE;
  document.getElementById('tonightDialog').close();
}

function saveTonight() {
  SAVED_TONIGHT_NOTE = document.getElementById('planNotes').value.trim();
  updateTonightButtonLabel();
  document.getElementById('tonightDialog').close();
}

function openSettings() {
  updateSettingsDebugPanel();
  document.getElementById('settingsDialog').showModal();
}

function closeSettings() {
  document.getElementById('settingsDialog').close();
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
  updateStockStrip();
}

// Always-visible summary of stock state, pinned in the header regardless of
// which section is open — everything else in this app is built from stock,
// so this should always be knowable at a glance without having to navigate
// to (or expand) the inventory section itself.
function updateStockStrip() {
  var el = document.getElementById('stockStrip');
  if (!el) return;
  if (ITEMS.length === 0) {
    el.textContent = 'No food logged yet — tap to add some ›';
    return;
  }
  var low = 0, soon = 0;
  ITEMS.forEach(function (item) {
    if (item.status === 'Running low') low++;
    else if (item.status === 'Use soon') soon++;
  });
  var parts = [ITEMS.length + (ITEMS.length === 1 ? ' item' : ' items') + ' in stock'];
  if (low > 0) parts.push(low + ' running low');
  if (soon > 0) parts.push(soon + ' to use soon');
  // The headline number from the plan ("20 genuine dinners ready") only
  // meant anything once you'd opened the plan — but it's exactly the "how
  // many days could we go without shopping" answer this header is for, so
  // it belongs up here too, not just below the fold. Only shown once a
  // plan has actually been fetched at least once (PLAN_LOADED), so a fresh
  // page load doesn't flash "0 meals ready" before the real count arrives.
  if (PLAN_LOADED) {
    parts.push(LAST_MEALS.length + (LAST_MEALS.length === 1 ? ' meal ready' : ' meals ready'));
  }
  el.textContent = parts.join(' · ') + ' ›';
}

function openInventory() {
  document.getElementById('inventoryDialog').showModal();
}

function closeInventory() {
  document.getElementById('inventoryDialog').close();
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
var LAST_PLAN_TEXT = '';
var PENDING_SHOPPING_LIST = [];
var PENDING_SHOPPING_RESOLVE_ID = null;
// Set true the first time the shared plan has actually been fetched, zero
// ready meals included — distinguishes "we know it's genuinely zero" from
// "we haven't asked yet", so the header's meal count never flashes 0
// before the real answer comes back.
var PLAN_LOADED = false;

// Restores whatever plan the household last generated (from this phone or
// any other) so reloading the page doesn't lose it — the plan is a single
// shared record on the server now, not just a page-local variable. On a
// genuinely blank install (never generated, nothing to show) this stays
// hidden so the big "What can we eat?" button is the only call to action —
// unless forceRender is set, which a dismiss/replace reload needs so a
// result that happens to come back fully empty still clears whatever
// "Finding something else…" loading state is currently on screen instead
// of leaving it stuck.
function loadPlan(forceRender) {
  apiFetch('/family/api/plan-meal').then(function (res) {
    if (!res.body.ok) return;
    var meals = res.body.meals || [];
    var almostMeals = res.body.almostMeals || [];
    PLAN_LOADED = true;
    if (!forceRender && meals.length === 0 && almostMeals.length === 0 && !res.body.plan) {
      LAST_MEALS = meals;
      updateStockStrip();
      return;
    }
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
  // Needs a longer client-side allowance than the default 30s apiFetch
  // uses elsewhere — the server's own Anthropic-call timeout is 90s (see
  // server-routes.ts), and the client must never cut the connection
  // before that, or every slow-but-successful generation gets wrongly
  // reported as a timeout instead of actually completing.
  apiFetch('/family/api/plan-meal', { method: 'POST', body: JSON.stringify({ notes: notes, debug: DEBUG_MODE }), signal: AbortSignal.timeout(110000) }).then(function (res) {
    clearInterval(timer);
    btn.disabled = false;
    if (!res.body.ok) { box.textContent = 'Could not plan right now: ' + (res.body.error || 'unknown error'); return; }
    if (res.body.debug) LAST_DEBUG = res.body.debug;
    renderPlan(res.body.plan, res.body.meals || [], res.body.almostMeals || []);
  });
}

// Keyword -> food-category icon, checked in order (first match wins). No
// live photo lookup at all — deliberately: a third-party image search
// (previously Pixabay) kept failing in ways nobody could see coming
// (rate limits, zero-hit misses, wrong photos) and no amount of tuning
// the search query made it reliably solid. A fixed local icon always
// renders, every time, for free.
var FOOD_ICON_RULES = [
  [/\\bpizzas?\\b/, '🍕'],
  [/\\b(spaghetti|pasta|lasagne|macaroni|penne|tagliatelle|carbonara)\\b/, '🍝'],
  [/\\b(pies?|mash)\\b/, '🥧'],
  [/\\broasts?\\b/, '🍗'],
  [/\\bcurr(y|ies)\\b/, '🍛'],
  [/\\b(stir.?frys?|noodles?|chow mein|ramen)\\b/, '🍜'],
  [/\\b(soups?|stews?|casseroles?|chowders?)\\b/, '🍲'],
  [/\\bsalads?\\b/, '🥗'],
  [/\\bburgers?\\b/, '🍔'],
  [/\\b(sandwiches?|toasties?|wraps?|paninis?)\\b/, '🥪'],
  [/\\b(fish|salmon|cod|haddock)\\b/, '🐟'],
  [/\\b(tacos?|burritos?|fajitas?|quesadillas?|enchiladas?)\\b/, '🌮'],
  [/\\b(rice|risottos?|paellas?|biryanis?)\\b/, '🍚'],
  [/\\b(bbq|barbecues?|grills?|kebabs?)\\b/, '🍖'],
  [/\\b(eggs?|breakfast|omelettes?|pancakes?)\\b/, '🍳'],
  [/\\bsausages?\\b/, '🌭'],
  [/\\b(cakes?|desserts?|puddings?|pastr(y|ies)|tarts?)\\b/, '🍰'],
  [/\\b(breads?|baguettes?|toast)\\b/, '🍞'],
  [/\\b(steaks?|beef)\\b/, '🥩'],
  [/\\bchicken\\b/, '🍗'],
  [/\\b(dumplings?|gyozas?)\\b/, '🥟'],
  [/\\bsushi\\b/, '🍣'],
];
function mealIconFor(meal) {
  var query = photoQueryFor(meal.photoQuery || meal.name).toLowerCase();
  for (var i = 0; i < FOOD_ICON_RULES.length; i++) {
    if (FOOD_ICON_RULES[i][0].test(query)) return FOOD_ICON_RULES[i][1];
  }
  return '🍽️';
}

var EFFORT_LABELS = { quick: '⚡ Quick', moderate: '🕐 Moderate', slow: '🐢 Slow cook' };
function effortBadge(meal) {
  var label = EFFORT_LABELS[meal.effort] || EFFORT_LABELS.moderate;
  return '<div class="meal-effort">' + escapeHtml(label) + '</div>';
}

// Shows exactly what was sent to and received from the model for the most
// recent plan/replace call, so a surprising suggestion ("why is it
// suggesting a bacon sandwich for dinner?") can be checked against the
// actual prompt rather than guessed at. Only ever rendered with DEBUG_MODE
// on — never sent to or stored anywhere beyond this one response. Lives in
// the Settings dialog (where the toggle is), not the main plan view — a
// household member who's never turned this on should never see it.
function renderDebugPanel() {
  if (!DEBUG_MODE) return '';
  if (!LAST_DEBUG) {
    return '<div class="debug-block">🔧 AI details is on — tap "What can we eat?", dismiss a card, or "More options" to see the prompt and reply for that request here.</div>';
  }
  return '<details class="debug-block"><summary>🔧 AI details (most recent request)</summary>' +
    '<div class="debug-label">System prompt</div><pre>' + escapeHtml(LAST_DEBUG.systemPrompt) + '</pre>' +
    '<div class="debug-label">User prompt</div><pre>' + escapeHtml(LAST_DEBUG.userPrompt) + '</pre>' +
    '<div class="debug-label">Raw model reply</div><pre>' + escapeHtml(LAST_DEBUG.rawText) + '</pre>' +
    '</details>';
}

function updateSettingsDebugPanel() {
  var el = document.getElementById('settingsDebugPanel');
  if (el) el.innerHTML = renderDebugPanel();
}

// Whether a dismiss/"+ More options" request is currently in flight —
// checked by both triggers so a second tap while one is still waiting on
// the AI doesn't fire a pile of overlapping requests (which used to read as
// the page being stuck, since each tap re-showed its own loading state).
var PLAN_LOADING = false;

// Used by dismissMeal, which (unlike requestMoreOptions — see its own
// inline "+ More options" card loading state) has no single card left to
// show the loading state on, since the dismissed card is exactly the one
// about to disappear. A background dismiss/replace call used to replace
// the ENTIRE plan area with a bare spinner while it waited on the AI —
// which read as "it's lost all my recipes" — so this shows a small banner
// above the existing cards instead and leaves them exactly where they
// are; the next full renderPlan() (via loadPlan(true)) replaces it along
// with everything else once the real result is in.
function setPlanLoading(loading, text) {
  PLAN_LOADING = loading;
  var box = document.getElementById('planResult');
  var banner = document.getElementById('planLoadingBanner');
  if (loading) {
    box.style.display = 'block';
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'planLoadingBanner';
      banner.className = 'plan-loading-banner';
      box.insertBefore(banner, box.firstChild);
    }
    banner.innerHTML = '<div class="spinner"></div><div>' + escapeHtml(text) + '</div>';
  } else if (banner) {
    banner.remove();
  }
}

// One-line note shown once, the next time the plan re-renders, when a
// replace call comes back with no further distinct suggestion — cleared
// immediately after being shown so it never lingers on a later reload.
var LAST_REPLACE_NOTE = null;

function renderPlan(plan, meals, almostMeals) {
  LAST_MEALS = meals;
  LAST_ALMOST = almostMeals;
  LAST_PLAN_TEXT = plan;
  var box = document.getElementById('planResult');
  // The big "What can we eat?" button is how a never-before-generated
  // household gets started. Once there's an actual plan on screen, dismiss
  // and "+ More options" are how the household keeps browsing — there's no
  // wipe-everything "refresh" any more, so the button only needs to come
  // back if the plan is genuinely empty (nothing to dismiss or extend
  // from), as a way to try again.
  var hasContent = meals.length > 0 || almostMeals.length > 0;
  document.getElementById('planBtn').style.display = hasContent ? 'none' : 'block';
  // The headline count comes from the actual meals array, never from the
  // model's own prose — asking the model to state a count in free text
  // alongside the structured list let the two drift out of sync (prose
  // said "6 dinners", the list came back empty) if it forgot to fill in
  // one of the two. Computing it here makes that contradiction impossible.
  var headline = meals.length === 0
    ? 'No genuine dinners from current stock right now'
    : meals.length + (meals.length === 1 ? ' genuine dinner ready' : ' genuine dinners ready');
  var html = '';
  if (LAST_REPLACE_NOTE) {
    html += '<div class="plan-note">' + escapeHtml(LAST_REPLACE_NOTE) + '</div>';
    LAST_REPLACE_NOTE = null;
  }
  html += '<div class="plan-headline">' + escapeHtml(headline) + '</div>';
  if (plan) html += '<div class="plan-text">' + escapeHtml(plan) + '</div>';
  if (meals.length === 0) {
    html += '<div class="meal-empty">No ready meals right now — see "Unlock more meals" below, or tap "What can we eat?" above if this looks wrong.</div>';
  } else {
    html += '<div class="meal-carousel">';
    meals.forEach(function (meal, i) {
      html += '<div class="meal-card">';
      html += '<div class="meal-head"><div class="meal-icon">' + mealIconFor(meal) + '</div><div class="meal-head-text"><div class="meal-name">' + escapeHtml(meal.name) + '</div>';
      if (meal.reason) html += '<div class="meal-reason">' + escapeHtml(meal.reason) + '</div>';
      html += '</div></div>';
      html += effortBadge(meal);
      if (meal.notes) html += '<div class="meal-notes">⭐ Your way: ' + escapeHtml(meal.notes) + '</div>';
      if (meal.usedItems.length > 0) {
        var itemsText = meal.usedItems.map(function (entry) {
          return escapeHtml(entry.name) + ' (' + escapeHtml(String(entry.suggestedRemove)) + (entry.unit ? ' ' + escapeHtml(entry.unit) : '') + ')';
        }).join(', ');
        html += '<div class="meal-items">Uses: ' + itemsText + '</div>';
        html += '<button class="cook-btn" id="cookBtn-' + i + '" onclick="applyUsedItems(' + i + ')">Cooked it → remove from inventory</button>';
      }
      html += '<button class="favorite-btn" onclick="saveMealAsFavorite(' + i + ')">⭐ Save as favorite</button>';
      html += '<button class="dismiss-btn" onclick="dismissReadyMeal(' + i + ')">Dismiss</button>';
      html += '</div>';
    });
    html += '<div class="meal-card more-card" id="moreCard-ready" onclick="requestMoreOptions(' + "'ready'" + ')"><div class="more-card-inner"><div class="more-icon">+</div><div>More options</div></div></div>';
    html += '</div>';
  }
  if (almostMeals.length > 0) {
    html += '<div class="almost-heading">Unlock more meals — just a few items away</div>';
    html += '<div class="meal-carousel">';
    almostMeals.forEach(function (meal, i) {
      var missingText = meal.missing.map(function (m) {
        return escapeHtml(m.item) + (m.quantity ? ' (' + escapeHtml(m.quantity) + ')' : '');
      }).join(', ');
      var cardClass = meal.unlocked ? 'meal-card selected' : 'meal-card locked';
      html += '<div class="' + cardClass + '" id="' + escapeAttr(mealAnchorId(meal.name)) + '">';
      html += '<div class="meal-head"><div class="meal-icon">' + mealIconFor(meal) + '</div><div class="meal-head-text"><div class="meal-name">' + escapeHtml(meal.name) + '</div>';
      if (meal.reason) html += '<div class="meal-reason">' + escapeHtml(meal.reason) + '</div>';
      html += '</div></div>';
      html += effortBadge(meal);
      if (meal.unlocked) {
        html += '<div class="selected-badge">✓ On the shopping list</div>';
        html += '<a class="shop-list-link" href="#' + escapeAttr(shopGroupAnchorId(meal.name)) + '">View shopping list ↓</a>';
      } else {
        html += '<div class="meal-missing">Needs: ' + missingText + '</div>';
        html += '<button class="unlock-btn" id="unlockBtn-' + i + '" onclick="unlockMeal(' + i + ')">Add to list</button>';
      }
      html += '<button class="dismiss-btn" onclick="dismissAlmostMeal(' + i + ')">Dismiss</button>';
      html += '</div>';
    });
    html += '<div class="meal-card more-card" id="moreCard-almost" onclick="requestMoreOptions(' + "'almost'" + ')"><div class="more-card-inner"><div class="more-icon">+</div><div>More options</div></div></div>';
    html += '</div>';
  }
  box.innerHTML = html;
  updateSettingsDebugPanel();
  updateStockStrip();
}

// Fetches exactly one more suggestion of the given kind, distinct from
// everything already in the plan, and appends it server-side — this is
// the engine behind both "+ More options" (requestMoreOptions) and a
// dismiss automatically being replaced (dismissMeal), so the household is
// never left paging through a shrinking list or hitting a dead end, the
// same way a shopping app just keeps paging in more products. Resolves
// once the server call settles; never rejects, so it's always safe to
// chain a final loadPlan() after it regardless of outcome.
function performReplace(kind) {
  var notes = document.getElementById('planNotes').value.trim();
  return apiFetch('/family/api/plan-meal/replace', {
    method: 'POST',
    body: JSON.stringify({ kind: kind, notes: notes, debug: DEBUG_MODE }),
    signal: AbortSignal.timeout(50000),
  }).then(function (res) {
    if (!res.body.ok) { reportIfFailed(res); return; }
    if (res.body.debug) LAST_DEBUG = res.body.debug;
    if (!res.body.meal) {
      // atCapacity means the server didn't even ask the model — tapping
      // the button enough times doesn't replenish the pantry, so there's a
      // real ceiling on how many meals it'll keep stacking up. Either way,
      // never leave it as a flat dead end — always point at the next
      // concrete thing to do.
      LAST_REPLACE_NOTE = res.body.atCapacity
        ? (kind === 'ready'
            ? "That's a generous stack of ready meals already — your stock can't stretch much further than this. Cook one, or dismiss a card you don't want."
            : "That's plenty of near-miss meals to browse already — dismiss one you don't want to see something different.")
        : (kind === 'ready'
            ? "That's everything genuinely different your current stock can make right now — dismiss a card you don't want, check \\"Unlock more meals\\" below, or go shopping to open up more."
            : "That's everything genuinely different your stock is close to right now — go shopping for one of these, or dismiss a card you don't want.");
    }
  });
}

function requestMoreOptions(kind) {
  if (PLAN_LOADING) return;
  PLAN_LOADING = true;
  // Showing "Finding another option…" as a banner at the top of the whole
  // plan, disconnected from the "+ More options" card that was actually
  // tapped, read as unclear about what was even loading. Putting it on
  // that same card instead makes the cause and effect obvious; the next
  // loadPlan(true) replaces this card (along with everything else) once
  // the real result is in, so there's nothing to revert by hand here.
  var card = document.getElementById('moreCard-' + kind);
  if (card) {
    card.onclick = null;
    card.innerHTML = '<div class="more-card-inner"><div class="spinner" style="margin:0 auto 4px;"></div><div>Finding another option…</div></div>';
  }
  performReplace(kind).then(function () { PLAN_LOADING = false; loadPlan(true); });
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
      // Re-fetches the shared plan (now showing this meal as unlocked) so
      // the card switches to its "selected" visual state and gains the
      // link down to its shopping-list items — not just a local button
      // label change that would reset on reload.
      loadPlan();
      loadShoppingList();
    });
}

function dismissReadyMeal(index) {
  dismissMeal(LAST_MEALS[index], 'ready');
}

function dismissAlmostMeal(index) {
  dismissMeal(LAST_ALMOST[index], 'almost');
}

function dismissMeal(meal, kind) {
  if (!meal || PLAN_LOADING) return;
  var message = (kind === 'almost' && meal.unlocked)
    ? 'Dismiss ' + meal.name + '? This also removes its items from the shopping list.'
    : 'Dismiss ' + meal.name + ' from the plan?';
  if (!confirm(message)) return;
  setPlanLoading(true, 'Finding something else…');
  apiFetch('/family/api/plan-meal/dismiss', { method: 'POST', body: JSON.stringify({ mealName: meal.name, kind: kind }) })
    .then(function (res) {
      if (!reportIfFailed(res)) return undefined;
      loadShoppingList();
      // Dismissing is never just "one fewer option" — it's the signal that
      // drives the next one in, so the household always has something
      // fresh to look at rather than a shrinking list.
      return performReplace(kind);
    })
    .then(function () { setPlanLoading(false); loadPlan(true); });
}

function escapeAttr(s) { return String(s).replace(/"/g, '&quot;'); }

// --- Favorites: a household-customized meal, saved once (from a meal
// card's "Save as favorite", or edited from scratch) so it can be dropped
// straight onto the ready-meals plan later with no AI call — always
// exactly the household's own version, the direct fix for the model
// guessing a generic recipe for a dish it should already know better.
var FAVORITES = [];

function loadFavorites() {
  return apiFetch('/family/api/recipes').then(function (res) {
    if (!res.body.ok) return;
    FAVORITES = res.body.recipes || [];
    renderFavoritesList();
  });
}

function renderFavoritesList() {
  var box = document.getElementById('favoritesList');
  if (!box) return;
  if (FAVORITES.length === 0) {
    box.innerHTML = '<div class="meal-empty">No favorites saved yet — tap "⭐ Save as favorite" on a meal card to add one, made your way.</div>';
    return;
  }
  var html = '';
  FAVORITES.forEach(function (fav, i) {
    html += '<div class="item">';
    html += '<div class="info" onclick="editFavorite(' + i + ')"><div class="name">' + escapeHtml(fav.name) + '</div>';
    if (fav.notes) html += '<div class="meta">' + escapeHtml(fav.notes) + '</div>';
    html += '</div>';
    html += '<button class="usedbtn" onclick="addFavoriteToPlan(' + i + ')">Add to plan</button>';
    html += '</div>';
  });
  box.innerHTML = html;
}

function openFavorites() {
  document.getElementById('favoritesDialog').showModal();
  loadFavorites();
}

function closeFavorites() {
  document.getElementById('favoritesDialog').close();
}

function editFavorite(index) {
  var fav = FAVORITES[index];
  if (!fav) return;
  openFavoriteEditor(fav.id, fav);
}

function addFavoriteToPlan(index) {
  var fav = FAVORITES[index];
  if (!fav) return;
  apiFetch('/family/api/plan-meal/add-favorite', { method: 'POST', body: JSON.stringify({ recipeId: fav.id }) })
    .then(function (res) {
      if (!reportIfFailed(res)) return;
      if (!res.body.meal) {
        alert(res.body.atCapacity
          ? "That's a generous stack of ready meals already — cook one or dismiss a card first."
          : (fav.name + ' is already in your ready meals.'));
        return;
      }
      closeFavorites();
      loadPlan(true);
    });
}

// Also used to open the editor pre-filled from an existing suggested meal
// card (editId left blank) — a meal and a FavoriteRecipe both have
// name/notes-or-reason/effort, so the same prefill logic covers both.
function openFavoriteEditor(editId, source) {
  document.getElementById('favoriteEditId').value = editId || '';
  document.getElementById('favoriteDialogTitle').textContent = editId ? 'Edit favorite' : 'Save as favorite';
  document.getElementById('favoriteName').value = source ? source.name : '';
  document.getElementById('favoriteNotes').value = source ? (source.notes || source.reason || '') : '';
  document.getElementById('favoriteEffort').value = (source && source.effort) || 'moderate';
  document.getElementById('favoriteDeleteBtn').style.display = editId ? 'inline-block' : 'none';
  document.getElementById('favoriteDialog').showModal();
}

function closeFavoriteEditor() {
  document.getElementById('favoriteDialog').close();
}

function saveMealAsFavorite(index) {
  var meal = LAST_MEALS[index];
  if (!meal) return;
  openFavoriteEditor(null, meal);
}

function saveFavoriteEditor() {
  var id = document.getElementById('favoriteEditId').value;
  var name = document.getElementById('favoriteName').value.trim();
  if (!name) { alert('Give the recipe a name.'); return; }
  var payload = {
    name: name,
    notes: document.getElementById('favoriteNotes').value.trim(),
    effort: document.getElementById('favoriteEffort').value,
  };
  var req = id
    ? apiFetch('/family/api/recipes/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(payload) })
    : apiFetch('/family/api/recipes', { method: 'POST', body: JSON.stringify(payload) });
  req.then(function (res) {
    if (!reportIfFailed(res)) return;
    closeFavoriteEditor();
    if (document.getElementById('favoritesDialog').open) loadFavorites();
  });
}

function deleteFavoriteFromEditor() {
  var id = document.getElementById('favoriteEditId').value;
  if (!id || !confirm('Remove this favorite?')) return;
  apiFetch('/family/api/recipes/' + encodeURIComponent(id), { method: 'DELETE' })
    .then(function (res) {
      if (!reportIfFailed(res)) return;
      closeFavoriteEditor();
      loadFavorites();
    });
}

function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Stable anchor ids linking an almost-there meal's card to its matching
// group in the shopping list, and back — plain in-page #anchor links, with
// no JS needed to find the element and no error if one isn't on the page
// right now (e.g. the plan's since been refreshed).
function mealAnchorId(name) {
  return 'almostMeal-' + slugify(name);
}

function shopGroupAnchorId(name) {
  return 'shopGroup-' + slugify(name);
}

// A meal's display name is often a compound description ("Chicken and bacon
// pies with mash and peas") that matches the icon keyword list poorly —
// stripping the part after "with" leaves just the core dish ("Chicken and
// bacon pies") for mealIconFor to match against.
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
    var groupId = group.label !== 'Other' ? ' id="' + escapeAttr(shopGroupAnchorId(group.label)) + '"' : '';
    html += '<div class="shop-meal-group"' + groupId + '><span class="cat-heading">' + escapeHtml(group.label) + '</span>';
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
