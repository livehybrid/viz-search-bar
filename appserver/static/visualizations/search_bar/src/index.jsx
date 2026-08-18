/*
 * Search Bar — Dashboard Studio custom visualization.
 *
 * Renders the official @splunk/react-search components (named exports), which
 * have two DIFFERENT prop contracts:
 *   component "bar"   -> Bar   (full SPL SearchBar + time-range picker)
 *                        props: options={{search, earliest, latest, ...}},
 *                               onOptionsChange(delta), onEventTrigger(evt)
 *                        (delta = {search} on typing, {earliest, latest} on
 *                        time change; evt = 'submit' | 'escape')
 *   component "input" -> Input (clean ACE SPL editor — ideal for pipelines)
 *                        props: value, onChange(e, {value}), onEnter, onEsc
 *
 * On submit it fires triggerDrilldown so a drilldown.setToken handler can
 * capture row.query.value (and row.earliest/row.latest from the Bar's time
 * picker) into dashboard tokens.
 *
 * The custom-viz iframe is sandboxed WITHOUT allow-forms, so we never use a
 * <form>/submit — submission is pure JS (onEventTrigger / onEnter / onClick).
 * If the real component throws during render, an ErrorBoundary degrades to a
 * styled native input (also formless) so the viz is never a blank box.
 */
import React from 'react';
import ReactDOM from 'react-dom';
import { SplunkThemeProvider } from '@splunk/themes';
import { Bar as SplBar, Input as SplInput } from '@splunk/react-search';
import { valueFromChange, buildDrilldownPayload, applyBarDelta } from './lib';

const api = () => globalThis.DashboardExtensionAPI;
function readOptions() {
    try { const o = api().getOptions() || {}; return o.options || o || {}; } catch (e) { return {}; }
}
function fire(tokenName, v, timeRange) {
    try {
        const a = api();
        if (a && a.triggerDrilldown) {
            // 'custom.click' is Studio's default drilldown action for custom
            // visualizations — it is what a dashboard-side drilldown.setToken
            // eventHandler matches. Any other action name is dropped silently.
            a.triggerDrilldown({
                action: 'custom.click',
                payload: buildDrilldownPayload(tokenName, v, timeRange),
                originalEvent: { type: 'click' },
            });
        }
    } catch (err) { try { api().setError({ message: String(err) }); } catch (e2) { /* noop */ } }
}

/* Formless styled fallback (no <form> — sandbox blocks form submission).
 * Uncontrolled on purpose: typing must not re-render the tree. */
function FallbackInput({ initialValue, placeholder, accent, buttonLabel, onChange, onEnter }) {
    return (
        <div style={{ display: 'flex', gap: 8, width: '100%' }}>
            <input
                type="text" defaultValue={initialValue} placeholder={placeholder}
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
            >{buttonLabel || 'Search'}</button>
        </div>
    );
}

class Boundary extends React.Component {
    constructor(p) { super(p); this.state = { failed: false }; }
    static getDerivedStateFromError() { return { failed: true }; }
    componentDidCatch(err) { try { api().setError({ message: 'SearchBar fell back: ' + String(err && err.message) }); } catch (e) { /* */ } }
    render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/*
 * The editor is deliberately UNCONTROLLED. Feeding every keystroke back into
 * the Bar's `options.search` prop re-renders the tree per keystroke; the Bar's
 * internal ACE effects re-register listeners on every identity change (no
 * cleanup) and the setValue/change cycle can recurse to a stack overflow.
 * Instead: handler identities are stable class fields, the latest value lives
 * in an instance field, and render only depends on the viz options.
 */
class App extends React.Component {
    constructor(p) {
        super(p);
        const opts = readOptions();
        this.state = { opts };
        this.latest = { value: String(opts.initialValue || ''), timeRange: null };
        this.handleChange = (e, data) => { this.latest.value = valueFromChange(e, data); };
        this.handleBarDelta = (delta) => {
            const d = applyBarDelta(delta);
            if (typeof d.value !== 'undefined') this.latest.value = d.value;
            if (typeof d.timeRange !== 'undefined') this.latest.timeRange = d.timeRange;
        };
        this.submit = () => {
            const opts2 = this.state.opts;
            fire(opts2.tokenName || 'search_query', this.latest.value, this.latest.timeRange);
        };
        this.handleBarEvent = (evt) => { if (evt === 'submit') this.submit(); };
    }
    componentDidMount() {
        const a = api();
        if (a.addOptionsListener) a.addOptionsListener((n) => this.setState({ opts: (n && (n.options || n)) || {} }));
        if (this.state.opts.autoSubmitOnLoad && this.latest.value) {
            [400, 1000, 1900].forEach((ms) => setTimeout(() => this.submit(), ms));
        }
    }
    render() {
        const { opts } = this.state;
        const placeholder = opts.placeholder || 'Type a search and press Enter…';
        const initialValue = String(opts.initialValue || '');
        const fallback = (
            <FallbackInput initialValue={initialValue} placeholder={placeholder} accent={opts.accentColor}
                buttonLabel={opts.buttonLabel} onChange={this.handleChange} onEnter={this.submit} />
        );

        let real = null;
        if (opts.component === 'input' && typeof SplInput === 'function') {
            real = (
                <SplInput value={initialValue} placeholder={placeholder}
                    onChange={this.handleChange} onEnter={this.submit} />
            );
        } else if (typeof SplBar === 'function') {
            real = (
                <SplBar
                    options={{ search: initialValue, placeholder }}
                    onOptionsChange={this.handleBarDelta}
                    onEventTrigger={this.handleBarEvent}
                />
            );
        }

        return (
            <SplunkThemeProvider family="prisma" colorScheme="dark" density="comfortable">
                <div style={{ width: '100%', padding: 4 }}>
                    {real ? <Boundary fallback={fallback}>{real}</Boundary> : fallback}
                </div>
            </SplunkThemeProvider>
        );
    }
}

// Surface any error visibly inside the box (append-only banner — doesn't wipe a working UI).
function showError(msg) {
    const root = document.getElementById('root');
    if (!root) return;
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;bottom:0;left:0;right:0;max-height:60%;overflow:auto;'
        + 'color:#ff8080;background:rgba(0,0,0,0.9);font:11px/1.4 monospace;padding:6px;white-space:pre-wrap;z-index:99999';
    d.textContent = 'viz-search-bar error: ' + String(msg);
    root.appendChild(d);
}
if (typeof window !== 'undefined') {
    window.addEventListener('error', (e) => showError((e.error && e.error.stack) || e.message));
    window.addEventListener('unhandledrejection', (e) => showError('promise: ' + ((e.reason && e.reason.message) || e.reason)));
}

function boot() {
    const a = api(); const root = document.getElementById('root');
    if (!a || !root) { setTimeout(boot, 25); return; }
    document.documentElement.style.cssText = 'height:100%;margin:0;';
    document.body.style.cssText = 'height:100%;margin:0;background:transparent;';
    root.style.cssText = 'position:absolute;inset:0;min-height:44px;';
    try {
        ReactDOM.render(<App />, root);
    } catch (err) {
        showError((err && err.stack) || err);
    }
}
boot();
