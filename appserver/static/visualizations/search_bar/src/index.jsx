/*
 * Search Bar — Dashboard Studio custom visualization (real Splunk UI).
 *
 * Wraps the official @splunk/react-search components:
 *   variant "bar"   -> the full SearchBar (ACE SPL editor + time-range picker + button)
 *   variant "input" -> just the ACE SPL editor (clean, for pipeline-style stages)
 *
 * On Enter (or auto-submit on load) it fires a Dashboard Studio drilldown
 * carrying the typed text, so a drilldown.setToken handler captures it into a token.
 */
import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { SplunkThemeProvider } from '@splunk/themes';
import SearchBar from '@splunk/react-search';
import Input from '@splunk/react-search/components/Input';

function getApi() {
    return globalThis.DashboardExtensionAPI;
}

function readOptions(api) {
    try {
        const o = api.getOptions() || {};
        return o.options || o || {};
    } catch (e) {
        return {};
    }
}

function themeProps(api) {
    let scheme = 'dark';
    try {
        const t = api.getTheme && api.getTheme();
        if (t && (t.colorScheme || t.scheme)) scheme = t.colorScheme || t.scheme;
    } catch (e) { /* default dark */ }
    return { family: 'prisma', colorScheme: scheme === 'light' ? 'light' : 'dark', density: 'comfortable' };
}

function valueFromChange(e, data) {
    if (data && typeof data.value !== 'undefined') return data.value;
    if (typeof e === 'string') return e;
    if (e && e.target && typeof e.target.value !== 'undefined') return e.target.value;
    return '';
}

function App({ api }) {
    const [opts, setOpts] = useState(() => readOptions(api));
    const [theme, setTheme] = useState(() => themeProps(api));
    const [value, setValue] = useState(() => String(readOptions(api).initialValue || ''));

    useEffect(() => {
        if (api.addOptionsListener) api.addOptionsListener((n) => setOpts((n && (n.options || n)) || {}));
        if (api.addThemeListener) api.addThemeListener(() => setTheme(themeProps(api)));
    }, [api]);

    const tokenName = opts.tokenName || 'search_query';

    const fire = useCallback((v) => {
        try {
            if (api.triggerDrilldown) {
                api.triggerDrilldown({
                    action: 'search',
                    payload: { name: tokenName, value: v, query: v, row: { query: { value: v } } },
                    originalEvent: { type: 'click' },
                });
            }
        } catch (err) {
            if (api.setError) api.setError({ message: String(err) });
        }
    }, [api, tokenName]);

    // auto-submit on load: seed the token from the pre-filled value (retried to beat the handler-registration race)
    useEffect(() => {
        if (opts.autoSubmitOnLoad && value) {
            const ts = [400, 1000, 1900].map((ms) => setTimeout(() => fire(value), ms));
            return () => ts.forEach(clearTimeout);
        }
        return undefined;
        // run once on mount with the initial value
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const onChange = (e, data) => setValue(valueFromChange(e, data));
    const onEnter = () => fire(value);
    const placeholder = opts.placeholder || 'Type a search and press Enter…';
    const common = { value, placeholder, onChange, onEnter };

    return (
        <SplunkThemeProvider {...theme}>
            <div style={{ width: '100%', padding: '4px' }}>
                {opts.component === 'input'
                    ? <Input {...common} />
                    : <SearchBar {...common} />}
            </div>
        </SplunkThemeProvider>
    );
}

function boot() {
    const api = getApi();
    const root = document.getElementById('root');
    if (!api || !root) { setTimeout(boot, 25); return; }
    document.documentElement.style.cssText = 'height:100%;margin:0;';
    document.body.style.cssText = 'height:100%;margin:0;background:transparent;';
    root.style.cssText = 'position:absolute;inset:0;';
    ReactDOM.render(<App api={api} />, root);
}

boot();
