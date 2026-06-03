/*
 * Search Bar — Dashboard Studio custom visualization.
 *
 * Renders the official @splunk/react-search SearchBar (or its ACE SPL Input).
 * If the real component fails to resolve/render inside the sandboxed Studio
 * iframe, a React ErrorBoundary degrades gracefully to a styled native input
 * with identical behaviour — so the viz is never a blank box and always sets
 * its token. On submit it fires triggerDrilldown -> drilldown.setToken.
 */
import React from 'react';
import ReactDOM from 'react-dom';
import { SplunkThemeProvider } from '@splunk/themes';
import * as SearchNS from '@splunk/react-search';
import * as InputNS from '@splunk/react-search/components/Input';

// Defensive interop — handle default / named / module-as-component shapes.
const SearchBar = (SearchNS && (SearchNS.default || SearchNS.SearchBar || SearchNS.Search)) || SearchNS;
const SplInput = (InputNS && (InputNS.default || InputNS.Input)) || InputNS;

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

// Styled native fallback (also used for the "input" variant) — looks Splunk-ish, always works.
function FallbackInput({ value, placeholder, accent, onChange, onEnter }) {
    const accentColor = accent || '#00a4fc';
    return (
        <form
            style={{ display: 'flex', gap: 8, width: '100%' }}
            onSubmit={(e) => { e.preventDefault(); onEnter(); }}
        >
            <input
                type="text"
                value={value}
                placeholder={placeholder}
                onChange={(e) => onChange(e)}
                style={{
                    flex: 1, height: 36, boxSizing: 'border-box', padding: '0 12px',
                    borderRadius: 4, border: '1px solid #6b7785', background: '#0b0c0e',
                    color: '#e7e9ea', fontSize: 14, outline: 'none', fontFamily: 'monospace',
                }}
            />
            <button
                type="submit"
                style={{
                    height: 36, padding: '0 18px', border: 'none', borderRadius: 4,
                    background: accentColor, color: '#fff', fontWeight: 600, cursor: 'pointer',
                }}
            >Run ▸</button>
        </form>
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
        const fallback = (
            <FallbackInput value={value} placeholder={placeholder} accent={opts.accentColor}
                onChange={onChange} onEnter={onEnter} />
        );
        // "input" variant intentionally uses the lightweight, reliable styled input.
        const useReal = opts.component !== 'input';
        const RealComp = SearchBar;
        return (
            <SplunkThemeProvider family="prisma" colorScheme="dark" density="comfortable">
                <div style={{ width: '100%', padding: 4 }}>
                    {useReal && typeof RealComp === 'function'
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
