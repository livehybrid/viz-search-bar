/*
 * Search Bar — Dashboard Studio custom visualization.
 *
 * Renders the official @splunk/react-search components (named exports):
 *   component "bar"   -> Bar   (full SPL SearchBar + time-range picker)
 *   component "input" -> Input (clean ACE SPL editor — ideal for pipeline stages)
 *
 * On Enter (or auto-submit on load) it fires triggerDrilldown -> drilldown.setToken.
 * The custom-viz iframe is sandboxed WITHOUT allow-forms, so we never use a
 * <form>/submit — submission is pure JS (onEnter / button onClick).
 * If the real component throws inside the sandbox, an ErrorBoundary degrades to
 * a styled native input (also formless) so the viz is never a blank box.
 */
import React from 'react';
import ReactDOM from 'react-dom';
import { SplunkThemeProvider } from '@splunk/themes';
import { Bar as SplBar, Input as SplInput } from '@splunk/react-search';

const api = () => globalThis.DashboardExtensionAPI;
function readOptions() {
    try { const o = api().getOptions() || {}; return o.options || o || {}; } catch (e) { return {}; }
}
function valueFromChange(e, data) {
    if (data && typeof data.value !== 'undefined') return data.value;
    if (typeof e === 'string') return e;
    if (e && e.target && typeof e.target.value !== 'undefined') return e.target.value;
    return '';
}
function fire(tokenName, v) {
    try {
        const a = api();
        if (a && a.triggerDrilldown) {
            a.triggerDrilldown({
                action: 'search',
                payload: { name: tokenName, value: v, query: v, row: { query: { value: v } } },
                originalEvent: { type: 'click' },
            });
        }
    } catch (err) { try { api().setError({ message: String(err) }); } catch (e2) { /* noop */ } }
}

/* Formless styled fallback (no <form> — sandbox blocks form submission). */
function FallbackInput({ value, placeholder, accent, onChange, onEnter }) {
    return (
        <div style={{ display: 'flex', gap: 8, width: '100%' }}>
            <input
                type="text" value={value} placeholder={placeholder}
                onChange={(e) => onChange(e)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } }}
                style={{
                    flex: 1, height: 36, boxSizing: 'border-box', padding: '0 12px', borderRadius: 4,
                    border: '1px solid #6b7785', background: '#0b0c0e', color: '#e7e9ea',
                    fontSize: 14, outline: 'none', fontFamily: 'monospace',
                }}
            />
            <button
                type="button" onClick={() => onEnter()}
                style={{
                    height: 36, padding: '0 18px', border: 'none', borderRadius: 4,
                    background: accent || '#00a4fc', color: '#fff', fontWeight: 600, cursor: 'pointer',
                }}
            >Run ▸</button>
        </div>
    );
}

class Boundary extends React.Component {
    constructor(p) { super(p); this.state = { failed: false }; }
    static getDerivedStateFromError() { return { failed: true }; }
    componentDidCatch(err) { try { api().setError({ message: 'SearchBar fell back: ' + String(err && err.message) }); } catch (e) { /* */ } }
    render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

class App extends React.Component {
    constructor(p) {
        super(p);
        const opts = readOptions();
        this.state = { opts, value: String(opts.initialValue || '') };
    }
    componentDidMount() {
        const a = api();
        if (a.addOptionsListener) a.addOptionsListener((n) => this.setState({ opts: (n && (n.options || n)) || {} }));
        const { opts, value } = this.state;
        if (opts.autoSubmitOnLoad && value) {
            [400, 1000, 1900].forEach((ms) => setTimeout(() => fire(opts.tokenName || 'search_query', this.state.value), ms));
        }
    }
    render() {
        const { opts, value } = this.state;
        const tokenName = opts.tokenName || 'search_query';
        const placeholder = opts.placeholder || 'Type a search and press Enter…';
        const onChange = (e, data) => this.setState({ value: valueFromChange(e, data) });
        const onEnter = () => fire(tokenName, this.state.value);
        const common = { value, placeholder, onChange, onEnter };
        const RealComp = opts.component === 'input' ? SplInput : SplBar;
        const fallback = (
            <FallbackInput value={value} placeholder={placeholder} accent={opts.accentColor}
                onChange={onChange} onEnter={onEnter} />
        );
        return (
            <SplunkThemeProvider family="prisma" colorScheme="dark" density="comfortable">
                <div style={{ width: '100%', padding: 4 }}>
                    {typeof RealComp === 'function'
                        ? <Boundary fallback={fallback}><RealComp {...common} /></Boundary>
                        : fallback}
                </div>
            </SplunkThemeProvider>
        );
    }
}

function boot() {
    const a = api(); const root = document.getElementById('root');
    if (!a || !root) { setTimeout(boot, 25); return; }
    document.documentElement.style.cssText = 'height:100%;margin:0;';
    document.body.style.cssText = 'height:100%;margin:0;background:transparent;';
    root.style.cssText = 'position:absolute;inset:0;';
    ReactDOM.render(<App />, root);
}
boot();
