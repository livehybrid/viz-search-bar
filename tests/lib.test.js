/*
 * Unit tests for the Search Bar's pure logic (src/lib.js).
 *
 * The payload shape is a hard contract with Studio's parent-side drilldown
 * bridge, which WHITELISTS payload keys: only `name`, `value`, `_span`,
 * `earliest`, `latest` and FLAT keys literally starting with "row." survive.
 * Nested objects are dropped silently — that exact mistake shipped in the
 * first implementation and made setToken silently never fire. These tests pin
 * the flat shape so it cannot come back.
 */
'use strict';

const { valueFromChange, buildDrilldownPayload, applyBarDelta } = require(
    '../appserver/static/visualizations/search_bar/src/lib'
);

describe('valueFromChange', () => {
    test('prefers the data.value convention of @splunk/react-search', () => {
        expect(valueFromChange({ target: { value: 'ignored' } }, { value: 'index=main' })).toBe('index=main');
    });

    test('accepts a plain string', () => {
        expect(valueFromChange('index=main')).toBe('index=main');
    });

    test('falls back to a native input event target', () => {
        expect(valueFromChange({ target: { value: 'index=main' } })).toBe('index=main');
    });

    test('returns empty string for unrecognised shapes', () => {
        expect(valueFromChange(null)).toBe('');
        expect(valueFromChange({}, {})).toBe('');
    });
});

describe('buildDrilldownPayload (Studio whitelist contract)', () => {
    const ALLOWED = (k) => ['name', 'value', '_span', 'earliest', 'latest'].includes(k) || k.startsWith('row.');

    test('exposes the typed value under both "value" and "row.query.value"', () => {
        const p = buildDrilldownPayload('search_query', 'index=main');
        expect(p.value).toBe('index=main');
        expect(p['row.query.value']).toBe('index=main');
        expect(p.name).toBe('search_query');
    });

    test('every key survives the Studio parent-side whitelist', () => {
        const p = buildDrilldownPayload('t', 'v', { earliest: '-24h', latest: 'now' });
        for (const key of Object.keys(p)) {
            expect(ALLOWED(key)).toBe(true);
        }
    });

    test('contains no nested objects (the bridge drops them silently)', () => {
        const p = buildDrilldownPayload('t', 'v', { earliest: '-24h', latest: 'now' });
        for (const v of Object.values(p)) {
            expect(typeof v).not.toBe('object');
        }
    });

    test('time range appears flat as earliest/latest and row.* aliases', () => {
        const p = buildDrilldownPayload('t', 'v', { earliest: '-24h', latest: 'now' });
        expect(p.earliest).toBe('-24h');
        expect(p.latest).toBe('now');
        expect(p['row.earliest.value']).toBe('-24h');
        expect(p['row.latest.value']).toBe('now');
    });

    test('omits time keys when no time range has been picked', () => {
        const p = buildDrilldownPayload('t', 'v', null);
        expect(p).not.toHaveProperty('earliest');
        expect(p).not.toHaveProperty('latest');
    });
});

describe('applyBarDelta', () => {
    test('extracts a typing delta', () => {
        expect(applyBarDelta({ search: 'index=main' })).toEqual({ value: 'index=main' });
    });

    test('extracts a time-range delta', () => {
        expect(applyBarDelta({ earliest: '-1h', latest: 'now' }))
            .toEqual({ timeRange: { earliest: '-1h', latest: 'now' } });
    });

    test('ignores unknown deltas', () => {
        expect(applyBarDelta({ nonsense: 1 })).toEqual({});
        expect(applyBarDelta(null)).toEqual({});
    });
});

describe('normaliseOptions (wrong-type options fall back to defaults)', () => {
    const { normaliseOptions, DEFAULTS } = require(
        '../appserver/static/visualizations/search_bar/src/lib'
    );

    test('no options at all gives every documented default', () => {
        expect(normaliseOptions(undefined)).toEqual(DEFAULTS);
        expect(normaliseOptions([])).toEqual(DEFAULTS);
    });

    test('valid values pass through unchanged', () => {
        const good = {
            component: 'input', placeholder: 'p', buttonLabel: 'Go', tokenName: 'q',
            initialValue: 'index=main', accentColor: '#112233', autoSubmitOnLoad: true,
        };
        expect(normaliseOptions(good)).toEqual(good);
    });

    test('autoSubmitOnLoad only turns on for true or "true"', () => {
        // "false" is a truthy string: before the fix it submitted on every load.
        for (const v of ['false', 'no', 0, 1, 'yes', {}, null]) {
            expect([v, normaliseOptions({ autoSubmitOnLoad: v }).autoSubmitOnLoad]).toEqual([v, false]);
        }
        expect(normaliseOptions({ autoSubmitOnLoad: 'true' }).autoSubmitOnLoad).toBe(true);
    });

    test('an object or array initialValue never becomes "[object Object]"', () => {
        expect(normaliseOptions({ initialValue: { a: 1 } }).initialValue).toBe('');
        expect(normaliseOptions({ initialValue: ['x'] }).initialValue).toBe('');
        expect(normaliseOptions({ initialValue: 42 }).initialValue).toBe('42');
    });

    test('unknown component, blank or non-string text and bad colours use defaults', () => {
        const o = normaliseOptions({
            component: 'nonsense', placeholder: '  ', buttonLabel: {}, tokenName: null,
            accentColor: 'url(javascript:alert(1))',
        });
        expect(o.component).toBe('bar');
        expect(o.placeholder).toBe(DEFAULTS.placeholder);
        expect(o.buttonLabel).toBe('Search');
        expect(o.tokenName).toBe('search_query');
        expect(o.accentColor).toBe('#00a4fc');
    });
});
