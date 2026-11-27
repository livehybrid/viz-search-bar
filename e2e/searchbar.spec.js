/*
 * End-to-end scenarios: the packaged app on a real Splunk, driven in a
 * headless browser inside Dashboard Studio (the viz is Studio-only:
 * framework_type = studio_visualization, so there is no Simple XML leg).
 *
 * Every token assertion is made on the search the dashboard dispatches and on
 * the dependent echo panel (see helpers.js), never on the viz's own DOM.
 *
 * Gotchas encoded here (learned on AirspaceWatch/realtime-clock): viz `type`
 * is `<app-dir>.<viz-folder>` with NO `splunk.` prefix, the dashboard XML
 * wrapper needs version="2", and Studio custom vizzes render inside a
 * sandboxed iframe so viz assertions must search all frames.
 */
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

const VIEWS = {
    searchbar_e2e: h.tokenDashboard('Search Bar E2E'),
    searchbar_e2e_input: h.tokenDashboard('Search Bar E2E input', { options: { component: 'input' } }),
    searchbar_e2e_autosubmit: h.tokenDashboard('Search Bar E2E autosubmit', {
        options: { initialValue: 'seeded_on_load', autoSubmitOnLoad: true },
    }),
    // Wrong types and out-of-range values everywhere. autoSubmitOnLoad "false"
    // is a truthy string: it must not submit the (valid) initialValue.
    searchbar_e2e_badopts: h.tokenDashboard('Search Bar E2E bad options', {
        options: {
            component: 'no_such_component', placeholder: 12345, buttonLabel: { a: 1 },
            tokenName: ['x'], accentColor: 'url(javascript:alert(1))',
            initialValue: 'must_not_autosubmit', autoSubmitOnLoad: 'false',
        },
    }),
    // initialValue as an object must not become "[object Object]", in the
    // editor or (with auto-submit on) in the token.
    searchbar_e2e_objvalue: h.tokenDashboard('Search Bar E2E object initialValue', {
        options: { initialValue: { not: 'a string' }, autoSubmitOnLoad: true },
    }),
    // The viz declares `primary` as an optional data source; an empty or
    // oddly shaped one must not stop it rendering or setting tokens.
    searchbar_e2e_empty: h.tokenDashboard('Search Bar E2E empty data', {
        vizExtra: { dataSources: { primary: 'ds_empty' } },
        dataSources: { ds_empty: { type: 'ds.search', options: { query: '| makeresults | where 1=0' } } },
    }),
    searchbar_e2e_malformed: h.tokenDashboard('Search Bar E2E malformed data', {
        vizExtra: { dataSources: { primary: 'ds_bad' } },
        dataSources: {
            ds_bad: {
                type: 'ds.search',
                options: { query: '| makeresults count=3 | eval "weird col"=null(), value="not a number", _time="x"' },
            },
        },
    }),
};

test.beforeAll(async () => { await h.putDashboards(VIEWS); });

async function open(page, view) {
    const w = h.watch(page);
    await h.login(page);
    const bar = await h.openAndFindBar(page, w, view);
    await h.expectNoBanner(bar);
    return { w, bar };
}

test('Search Bar sets a dashboard token that drives another panel', async ({ page }) => {
    const { w, bar } = await open(page, 'searchbar_e2e');
    await h.typeAndSubmit(page, bar, 'hello_e2e_token');
    await h.expectTokenFlow(page, w, 'hello_e2e_token');
    await page.screenshot({ path: 'e2e-results/searchbar-render.png' });
    expect(w.vizErrors()).toEqual([]);
});

test('a second submit replaces the token and the dependent panel follows', async ({ page }) => {
    const { w, bar } = await open(page, 'searchbar_e2e');
    await h.typeAndSubmit(page, bar, 'first_value_e2e');
    await h.expectTokenFlow(page, w, 'first_value_e2e');
    await h.typeAndSubmit(page, bar, 'second_value_e2e', { replace: true });
    await h.expectTokenFlow(page, w, 'second_value_e2e');
    // The echo panel shows the new value only, not a stale first render.
    await expect(page.getByText('first_value_e2e', { exact: true })).toHaveCount(0, { timeout: 30000 });
    expect(w.vizErrors()).toEqual([]);
});

test('component "input" (bare SPL editor) also sets the token', async ({ page }) => {
    const { w, bar } = await open(page, 'searchbar_e2e_input');
    await h.typeAndSubmit(page, bar, 'input_component_e2e');
    await h.expectTokenFlow(page, w, 'input_component_e2e');
    expect(w.vizErrors()).toEqual([]);
});

test('autoSubmitOnLoad seeds the token from initialValue with no interaction', async ({ page }) => {
    const { w } = await open(page, 'searchbar_e2e_autosubmit');
    await h.expectTokenFlow(page, w, 'seeded_on_load');
    expect(w.vizErrors()).toEqual([]);
});

test('wrong-type options fall back to defaults: autoSubmitOnLoad "false" does not submit', async ({ page }) => {
    const { w, bar } = await open(page, 'searchbar_e2e_badopts');
    // The auto-submit timers fire at 0.4, 1 and 1.9 s after mount.
    await page.waitForTimeout(6000);
    expect(w.echoSearchesFor('must_not_autosubmit'),
        'autoSubmitOnLoad:"false" submitted the initial value on load').toEqual([]);
    // Positive control: the same spy sees a search once the user submits.
    await h.typeAndSubmit(page, bar, 'after_bad_opts', { replace: true });
    await h.expectTokenFlow(page, w, 'after_bad_opts');
    expect(w.vizErrors()).toEqual([]);
});

test('an object initialValue never reaches the editor or the token as "[object Object]"', async ({ page }) => {
    const { w, bar } = await open(page, 'searchbar_e2e_objvalue');
    await page.waitForTimeout(6000);
    const text = await bar.frame.evaluate(() => document.body.innerText);
    expect(text).not.toContain('[object Object]');
    expect(w.echoSearchesFor('[object Object]')).toEqual([]);
    expect(w.vizErrors()).toEqual([]);
});

test('an attached malformed data source does not stop the bar rendering or setting tokens', async ({ page }) => {
    const { w, bar } = await open(page, 'searchbar_e2e_malformed');
    await h.typeAndSubmit(page, bar, 'with_malformed_ds');
    await h.expectTokenFlow(page, w, 'with_malformed_ds');
    await h.expectNoBanner(bar);
    expect(w.vizErrors()).toEqual([]);
});

// Platform behaviour, pinned so it is not mistaken for a viz bug: when a
// bound data source returns zero rows, Studio replaces the panel with its own
// no-results placeholder and never mounts the viz (10.6 labels it with a
// Warning icon; 10.4 has no accessible label, so the check is that nothing
// mounts). The bar needs no data, so the README says not to bind one.
test('an attached empty data source: Studio shows its placeholder instead of the bar', async ({ page }) => {
    const w = h.watch(page);
    await h.login(page);
    await page.goto(`/en-GB/app/${h.HOST_APP}/searchbar_e2e_empty`);
    // The empty search was dispatched (the other scenarios mount within ~5 s
    // of this point), then give it ample time to have mounted if it would.
    await expect.poll(() => w.searches.some((s) => s.includes('where 1=0')), { timeout: 60000 }).toBe(true);
    await page.waitForTimeout(15000);
    for (const f of page.frames()) {
        if (f === page.mainFrame()) continue;
        expect(await f.$('input[type="text"], textarea, .ace_scroller').catch(() => null)).toBeNull();
    }
});
