/*
 * Search Bar — Splunk Dashboard Studio Custom Visualization
 *
 * Renders a Splunk-styled search input. On submit (Enter or the Search button)
 * it fires a Dashboard Studio drilldown carrying the typed text as the payload,
 * so a `drilldown.setToken` event handler on the panel can capture it into a
 * dashboard token. Wire it in the dashboard JSON like:
 *
 *   "eventHandlers": [
 *     { "type": "drilldown.setToken",
 *       "options": { "tokens": [
 *         { "token": "search_query", "key": "value" },
 *         { "token": "search_query_name", "key": "name" }
 *       ] } }
 *   ]
 *
 * Options (Studio editor):
 *   placeholder  (string)  Input placeholder text
 *   buttonLabel  (string)  Search button label
 *   tokenName    (string)  Echoed in payload.name (handy if you wire >1 bar)
 *   initialValue (string)  Pre-filled query
 *   accentColor  (string)  Button / focus accent (hex)
 */
(function () {
    'use strict';

    function boot() {
        var api = globalThis.DashboardExtensionAPI;
        var root = document.getElementById('root');
        if (!api || !root) { setTimeout(boot, 25); return; }

        document.documentElement.style.cssText = 'height:100%;margin:0;';
        document.body.style.cssText = 'height:100%;margin:0;background:transparent;font-family:Splunk Platform Sans,Roboto,Arial,sans-serif;';
        root.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;padding:8px 10px;box-sizing:border-box;';

        var opts = {};
        function readOpts() {
            try { var o = api.getOptions() || {}; opts = o.options || o || {}; } catch (e) {}
        }
        readOpts();
        if (api.addOptionsListener) api.addOptionsListener(function (n) { opts = (n && (n.options || n)) || {}; applyOpts(); });

        // --- build UI ---
        var wrap = document.createElement('form');
        wrap.style.cssText = 'display:flex;width:100%;gap:8px;align-items:stretch;';

        var field = document.createElement('div');
        field.style.cssText = 'position:relative;flex:1;display:flex;align-items:center;';

        var icon = document.createElement('div');
        icon.innerHTML = '🔍';
        icon.style.cssText = 'position:absolute;left:12px;font-size:14px;opacity:0.6;pointer-events:none;';

        var input = document.createElement('input');
        input.type = 'text';
        input.style.cssText = 'width:100%;height:36px;box-sizing:border-box;padding:0 12px 0 34px;border-radius:4px;' +
            'border:1px solid #6b7785;background:#0b0c0e;color:#e7e9ea;font-size:14px;outline:none;';

        var btn = document.createElement('button');
        btn.type = 'submit';
        btn.style.cssText = 'height:36px;padding:0 18px;border:none;border-radius:4px;color:#fff;font-size:14px;' +
            'font-weight:600;cursor:pointer;white-space:nowrap;';

        field.appendChild(icon); field.appendChild(input);
        wrap.appendChild(field); wrap.appendChild(btn);
        root.appendChild(wrap);

        function applyOpts() {
            input.placeholder = opts.placeholder || 'Type a search and press Enter…';
            btn.textContent = opts.buttonLabel || 'Search';
            var accent = opts.accentColor || '#00a4fc';
            btn.style.background = accent;
            input.onfocus = function () { input.style.borderColor = accent; input.style.boxShadow = '0 0 0 2px ' + hexA(accent, 0.25); };
            input.onblur = function () { input.style.borderColor = '#6b7785'; input.style.boxShadow = 'none'; };
            if (opts.initialValue && !input.value) input.value = String(opts.initialValue);
        }
        function hexA(hex, a) {
            var m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 'rgba(0,164,252,' + a + ')';
            var n = parseInt(m[1], 16);
            return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
        }
        applyOpts();

        // reflect existing token value on load (nice touch)
        try {
            if (api.getTokens) {
                var toks = api.getTokens() || {};
                var tn = opts.tokenName || 'search_query';
                if (toks[tn] != null && !input.value) input.value = String(toks[tn]);
            }
        } catch (e) {}

        // --- submit -> fire drilldown carrying the query ---
        function submit(e) {
            if (e) e.preventDefault();
            var value = input.value;
            var payload = {
                name: opts.tokenName || 'search_query',
                value: value,
                query: value,
                row: { query: { value: value } }
            };
            try {
                if (api.triggerDrilldown) {
                    api.triggerDrilldown({ action: 'search', payload: payload, originalEvent: { type: 'click' } });
                }
            } catch (err) { if (api.setError) api.setError({ message: String(err) }); }
            // brief visual confirmation
            var orig = btn.textContent; btn.textContent = '✓'; setTimeout(function () { applyOpts(); btn.textContent = orig; }, 600);
        }
        wrap.addEventListener('submit', submit);

        // re-apply on resize/theme not needed; options listener covers edits
    }

    boot();
})();
