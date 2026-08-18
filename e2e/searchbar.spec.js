/*
 * End-to-end interaction check: the packaged app, installed on a real Splunk,
 * renders the Search Bar inside a Dashboard Studio dashboard AND completes its
 * whole reason for existing — typing a value and pressing Enter fires a
 * drilldown that sets a dashboard token, which re-runs a dependent search
 * whose result appears in a second panel.
 *
 * Gotchas encoded here (learned on AirspaceWatch/realtime-clock): viz `type`
 * is `<app-dir>.<viz-folder>` with NO `splunk.` prefix, the dashboard XML
 * wrapper needs version="2", and Studio custom vizzes render inside a
 * sandboxed iframe so viz assertions must search all frames (built-in vizzes
 * like the echo panel render in the main frame).
 */
const { test, expect, request } = require('@playwright/test');

const MGMT_URL = process.env.SPLUNK_MGMT_URL || 'https://localhost:8089';
const USER = process.env.SPLUNK_USER || 'admin';
const PASS = process.env.SPLUNK_PASSWORD || 'Changeme1!';
const APP = 'viz-search-bar';
const VIEW = 'searchbar_e2e';

const TOKEN_VALUE = 'hello_e2e_token';

const definition = {
    version: '2',
    title: 'Search Bar E2E',
    description: 'Playwright interaction check for the Search Bar viz',
    dataSources: {
        ds_echo: {
            type: 'ds.search',
            options: { query: '| makeresults | eval echoed="$search_query$" | table echoed' },
            name: 'echo the token',
        },
    },
    visualizations: {
        viz_search: {
            type: `${APP}.search_bar`,
            options: { tokenName: 'search_query', placeholder: 'E2E search' },
            eventHandlers: [
                {
                    type: 'drilldown.setToken',
                    options: { tokens: [{ token: 'search_query', key: 'value' }] },
                },
            ],
            title: 'Search',
        },
        viz_echo: {
            type: 'splunk.singlevalue',
            dataSources: { primary: 'ds_echo' },
            title: 'Echo',
        },
    },
    inputs: {},
    defaults: {},
    layout: {
        type: 'grid',
        options: {},
        structure: [
            { item: 'viz_search', type: 'block', position: { x: 0, y: 0, w: 900, h: 90 } },
            { item: 'viz_echo', type: 'block', position: { x: 0, y: 90, w: 900, h: 300 } },
        ],
    },
};

const DASHBOARD_XML =
    `<dashboard version="2" theme="dark"><label>Search Bar E2E</label>` +
    `<definition><![CDATA[${JSON.stringify(definition)}]]></definition></dashboard>`;

test.beforeAll(async () => {
    const api = await request.newContext({
        baseURL: MGMT_URL,
        ignoreHTTPSErrors: true,
        httpCredentials: { username: USER, password: PASS },
    });
    // Create, or update if a previous run left it behind.
    const create = await api.post(`/servicesNS/${USER}/${APP}/data/ui/views?output_mode=json`, {
        form: { name: VIEW, 'eai:data': DASHBOARD_XML },
    });
    if (!create.ok()) {
        const update = await api.post(
            `/servicesNS/${USER}/${APP}/data/ui/views/${VIEW}?output_mode=json`,
            { form: { 'eai:data': DASHBOARD_XML } }
        );
        if (!update.ok()) {
            throw new Error(
                `could not create/update dashboard: ${create.status()} then ${update.status()}: ${await update.text()}`
            );
        }
    }
    await api.dispose();
});

// The bar is either @splunk/react-search's editor or the styled fallback
// input — match any editable element in any frame.
const EDITABLE = 'input[type="text"], textarea, [contenteditable="true"], [role="textbox"], [role="combobox"]';

async function findEditable(page, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        for (const f of page.frames()) {
            try {
                const h = await f.$(EDITABLE);
                if (h) return { frame: f, handle: h };
            } catch (_) { /* frame may detach mid-poll */ }
        }
        await page.waitForTimeout(2000);
    }
    console.log('frames at timeout:', page.frames().map((f) => f.url()));
    return null;
}

test('Search Bar sets a dashboard token that drives another panel', async ({ page }) => {
    const consoleAll = [];
    const consoleErrors = [];
    page.on('console', (msg) => {
        consoleAll.push(`${msg.type()}: ${msg.text()}`.slice(0, 300));
        if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
    page.on('response', (r) => {
        if (r.status() >= 400 || /visualization\.js|search_bar/.test(r.url())) {
            console.log(`HTTP ${r.status()} ${r.url()}`);
        }
    });

    // Splunk web form login
    await page.goto('/en-GB/account/login');
    await page.fill('input[name="username"]', USER);
    await page.fill('input[name="password"]', PASS);
    await page.press('input[name="password"]', 'Enter');
    await page.waitForURL(/\/(app|launcher|home)/, { timeout: 60000 });

    // Open the dashboard and wait for the search bar to mount (in any frame).
    // The main frame's own login/search chrome is excluded by only accepting
    // matches inside a NON-main frame (the viz iframe).
    await page.goto(`/en-GB/app/${APP}/${VIEW}`);
    let found = null;
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline && !found) {
        for (const f of page.frames()) {
            if (f === page.mainFrame()) continue;
            try {
                const h = await f.$(EDITABLE);
                if (h) { found = { frame: f, handle: h }; break; }
            } catch (_) { /* detached */ }
        }
        if (!found) await page.waitForTimeout(2000);
    }
    if (!found) {
        console.log('--- console messages (last 50) ---');
        consoleAll.slice(-50).forEach((l) => console.log(l));
        for (const f of page.frames()) {
            if (f === page.mainFrame()) continue;
            console.log(`--- frame content: ${f.url()} ---`);
            try { console.log((await f.content()).slice(0, 3000)); }
            catch (e) { console.log('frame content unavailable:', e.message); }
        }
    }
    expect(found, 'no editable search element found in any viz frame — see logged diagnostics').not.toBeNull();

    // The in-box error banner must not be present (it means the bundle threw)
    const bannerCount = await found.frame.evaluate(
        () => document.body.innerText.includes('viz-search-bar error:') ? 1 : 0
    );
    expect(bannerCount, 'the viz surfaced a runtime error banner').toBe(0);

    // Type a value and submit. The real @splunk/react-search component is an
    // ACE editor whose visible layers intercept pointer events, so click by
    // viewport coordinates (which land inside iframes) and then type through
    // the page keyboard. The styled fallback is a plain <input>, which the
    // same path drives fine.
    const visible = (await found.frame.$('.ace_scroller')) || found.handle;
    const box = await visible.boundingBox();
    expect(box, 'editable element has no bounding box').not.toBeNull();
    await page.mouse.click(box.x + Math.min(box.width / 2, 100), box.y + box.height / 2);
    await page.waitForTimeout(300);
    await page.keyboard.type(TOKEN_VALUE, { delay: 40 });

    // Prove the text actually landed in the editor before submitting.
    await expect
        .poll(async () => found.frame.evaluate(() => document.body.innerText), { timeout: 10000 })
        .toContain(TOKEN_VALUE);
    await page.keyboard.press('Enter');

    // The token flows: the dependent search re-runs and the echo panel shows
    // the typed value in the MAIN frame (built-in singlevalue viz).
    let echoed = false;
    const echoDeadline = Date.now() + 60000;
    while (Date.now() < echoDeadline && !echoed) {
        echoed = await page.getByText(TOKEN_VALUE).first().isVisible().catch(() => false);
        if (!echoed) await page.waitForTimeout(2000);
    }
    if (!echoed) {
        console.log('--- console messages (last 60) ---');
        consoleAll.slice(-60).forEach((l) => console.log(l));
        console.log('--- errors (incl. pageerror, unmasked) ---');
        consoleErrors.forEach((l) => console.log(l.slice(0, 1000)));
        console.log('--- viz frame text ---');
        try { console.log((await found.frame.evaluate(() => document.body.innerText)).slice(0, 1500)); }
        catch (e) { console.log('frame text unavailable:', e.message); }
    }
    expect(echoed, 'token value never appeared in the echo panel — see logged diagnostics').toBe(true);

    // Render + interaction proof artifact
    await page.screenshot({ path: 'e2e-results/searchbar-render.png' });

    // Surface (but tolerate) console noise; hard-fail only on our own module
    const vizErrors = consoleErrors.filter((e) => /search_bar|visualization\.js/.test(e));
    console.log(`console errors total=${consoleErrors.length}, viz-specific=${vizErrors.length}`);
    expect(vizErrors).toEqual([]);
});
