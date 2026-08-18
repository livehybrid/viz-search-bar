/*
 * Drift guards between the three places the visualization is declared:
 *   - default/visualizations.conf  (Splunk registration)
 *   - appserver/static/visualizations/search_bar/config.json (Studio editor)
 *   - appserver/static/visualizations/search_bar/src/index.jsx (behaviour)
 *
 * The `component` option was read by the source but missing from the schema
 * for months — exactly the class of drift these tests exist to catch.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VIZ_DIR = path.join(ROOT, 'appserver', 'static', 'visualizations', 'search_bar');

const conf = fs.readFileSync(path.join(ROOT, 'default', 'visualizations.conf'), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(VIZ_DIR, 'config.json'), 'utf8'));
const source = fs.readFileSync(path.join(VIZ_DIR, 'src', 'index.jsx'), 'utf8');

const EXPECTED_OPTIONS = [
    'accentColor', 'autoSubmitOnLoad', 'buttonLabel', 'component',
    'initialValue', 'placeholder', 'tokenName',
];

describe('visualizations.conf registration', () => {
    test('declares the search_bar stanza matching the viz directory name', () => {
        expect(conf).toMatch(/^\[search_bar\]$/m);
    });

    test('registers as a Studio visualization', () => {
        expect(conf).toMatch(/^framework_type\s*=\s*studio_visualization$/m);
    });

    test('declares no phantom stanzas for visualizations that do not exist', () => {
        const stanzas = [...conf.matchAll(/^\[([^\]]+)\]/gm)].map((m) => m[1]);
        const vizDirs = fs
            .readdirSync(path.join(ROOT, 'appserver', 'static', 'visualizations'))
            .filter((d) => fs.statSync(path.join(ROOT, 'appserver', 'static', 'visualizations', d)).isDirectory());
        for (const stanza of stanzas) {
            expect(vizDirs).toContain(stanza.split('.')[0]);
        }
    });
});

describe('config.json options schema', () => {
    const schemaKeys = Object.keys(config.config.optionsSchema);

    test('exposes exactly the options the source implements', () => {
        expect(schemaKeys.sort()).toEqual(EXPECTED_OPTIONS);
    });

    test.each(EXPECTED_OPTIONS)('option %s is read by the source', (key) => {
        expect(source).toMatch(new RegExp(`\\.${key}\\b`));
    });

    test('every editorConfig option exists in the options schema', () => {
        const editorOptions = [];
        for (const section of config.config.editorConfig) {
            for (const row of section.layout) {
                for (const cell of row) {
                    if (cell.option) editorOptions.push(cell.option);
                }
            }
        }
        expect(editorOptions.length).toBeGreaterThan(0);
        for (const opt of editorOptions) {
            expect(schemaKeys).toContain(opt);
        }
    });

    test('event handlers are enabled so drilldown.setToken can attach', () => {
        expect(config.hasEventHandlers).toBe(true);
        expect(config.showDrilldown).toBe(true);
    });
});

describe('shipped bundle', () => {
    test('the committed visualization.js is a build of the current contract', () => {
        const bundle = fs.readFileSync(path.join(VIZ_DIR, 'visualization.js'), 'utf8');
        // The Studio default drilldown action must be present — its absence
        // means the bundle predates the token-flow fix and setToken never fires.
        expect(bundle).toContain('custom.click');
    });
});
