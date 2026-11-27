/*
 * Shared plumbing for the e2e scenarios: REST dashboard creation, login, the
 * viz iframe finder, typing into the ACE editor, and a spy on the search jobs
 * the dashboard dispatches.
 *
 * Token assertions go through the dispatched search jobs (and the dependent
 * echo panel, a built-in viz in the main frame), never through the Search
 * Bar's own DOM. The viz never reads either, so a viz that renders the right
 * text but sets the wrong token cannot pass.
 */
const { expect, request } = require('@playwright/test');

const MGMT_URL = process.env.SPLUNK_MGMT_URL || 'https://localhost:8089';
const USER = process.env.SPLUNK_USER || 'admin';
const PASS = process.env.SPLUNK_PASSWORD || 'Changeme1!';
const APP = 'viz-search-bar';
// The viz app is is_visible = false and 10.6 404s views inside a hidden app,
// so the dashboards live in Search & Reporting, as a user's would.
const HOST_APP = 'search';

const EDITABLE = 'input[type="text"], textarea, [contenteditable="true"], [role="textbox"], [role="combobox"]';

function dashboardXml(definition) {
    return `<dashboard version="2" theme="dark"><label>${definition.title}</label>` +
        `<definition><![CDATA[${JSON.stringify(definition)}]]></definition></dashboard>`;
}

/* A Search Bar wired to drilldown.setToken plus an echo panel whose search
 * depends on the token. `vizExtra` is merged into the viz (options, dataSources). */
function tokenDashboard(title, { options = {}, vizExtra = {}, dataSources = {} } = {}) {
    return {
        version: '2',
        title,
        dataSources: {
            ds_echo: {
                type: 'ds.search',
                options: { query: '| makeresults | eval echoed="$search_query$" | table echoed' },
                name: 'echo the token',
            },
            ...dataSources,
        },
        visualizations: {
            viz_search: {
                type: `${APP}.search_bar`,
                options: { placeholder: 'E2E search', ...options },
                eventHandlers: [
                    { type: 'drilldown.setToken', options: { tokens: [{ token: 'search_query', key: 'value' }] } },
                ],
                title: 'Search',
                ...vizExtra,
            },
            viz_echo: { type: 'splunk.singlevalue', dataSources: { primary: 'ds_echo' }, title: 'Echo' },
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
}

async function putDashboards(views) {
    const api = await request.newContext({
        baseURL: MGMT_URL,
        ignoreHTTPSErrors: true,
        httpCredentials: { username: USER, password: PASS },
    });
    for (const [name, definition] of Object.entries(views)) {
        const xml = dashboardXml(definition);
        const create = await api.post(`/servicesNS/${USER}/${HOST_APP}/data/ui/views?output_mode=json`, {
            form: { name, 'eai:data': xml },
        });
        if (!create.ok()) {
            const update = await api.post(`/servicesNS/${USER}/${HOST_APP}/data/ui/views/${name}?output_mode=json`, {
                form: { 'eai:data': xml },
            });
            if (!update.ok()) {
                throw new Error(`could not create/update ${name}: ${create.status()} then ${update.status()}: ${await update.text()}`);
            }
        }
    }
    await api.dispose();
}

/* Console + dispatched-search capture. Call before navigating. */
function watch(page) {
    const w = { console: [], errors: [], searches: [] };
    page.on('console', (msg) => {
        w.console.push(`${msg.type()}: ${msg.text()}`.slice(0, 300));
        if (msg.type() === 'error') w.errors.push(msg.text());
    });
    page.on('pageerror', (err) => w.errors.push(`pageerror: ${err.message}`));
    page.on('request', (req) => {
        if (req.method() !== 'POST' || !/\/search\/(v2\/)?jobs(\?|$)/.test(req.url())) return;
        const body = req.postData() || '';
        let search = null;
        try { search = new URLSearchParams(body).get('search'); } catch (_) { /* not form encoded */ }
        if (!search) {
            try { search = JSON.parse(body).search; } catch (_) { /* not JSON */ }
        }
        w.searches.push(search || body);
    });
    w.vizErrors = () => w.errors.filter((e) => /search_bar|visualization\.js/.test(e));
    w.echoSearchesFor = (value) => w.searches.filter((s) => s.includes(`echoed="${value}"`));
    return w;
}

async function login(page) {
    await page.goto('/en-GB/account/login');
    await page.fill('input[name="username"]', USER);
    await page.fill('input[name="password"]', PASS);
    await page.press('input[name="password"]', 'Enter');
    // Pathname only: a regex over the whole URL also matches return_to=.
    await page.waitForURL((u) => /^\/[^/]+\/(app|launcher|home)\b/.test(new URL(u).pathname), { timeout: 60000 });
}

/* The viz renders in a sandboxed iframe; only non-main frames count, so the
 * main frame's own search chrome can never satisfy this. */
async function openAndFindBar(page, w, view) {
    await page.goto(`/en-GB/app/${HOST_APP}/${view}`);
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
        for (const f of page.frames()) {
            if (f === page.mainFrame()) continue;
            try {
                const h = await f.$(EDITABLE);
                if (h) return { frame: f, handle: h };
            } catch (_) { /* detached mid-poll */ }
        }
        await page.waitForTimeout(2000);
    }
    console.log('--- console (last 50) ---');
    w.console.slice(-50).forEach((l) => console.log(l));
    for (const f of page.frames()) {
        if (f === page.mainFrame()) continue;
        try { console.log(`--- frame ${f.url()} ---\n${(await f.content()).slice(0, 3000)}`); } catch (_) { /* */ }
    }
    throw new Error(`no editable search element in any viz frame of ${view}`);
}

async function expectNoBanner(bar) {
    const text = await bar.frame.evaluate(() => document.body.innerText);
    expect(text, 'the viz surfaced a runtime error banner').not.toContain('viz-search-bar error:');
}

/* ACE's visible layers intercept pointer events: click by viewport
 * coordinates (they land inside iframes) and type through the page keyboard. */
async function typeAndSubmit(page, bar, value, { replace = false } = {}) {
    const visible = (await bar.frame.$('.ace_scroller')) || bar.handle;
    const box = await visible.boundingBox();
    expect(box, 'editable element has no bounding box').not.toBeNull();
    await page.mouse.click(box.x + Math.min(box.width / 2, 100), box.y + box.height / 2);
    await page.waitForTimeout(300);
    if (replace) {
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.press('Backspace');
    }
    await page.keyboard.type(value, { delay: 40 });
    await expect.poll(() => bar.frame.evaluate(() => document.body.innerText), { timeout: 10000 }).toContain(value);
    await page.keyboard.press('Enter');
}

/* The token reached the dashboard: a search with the substituted value was
 * dispatched AND the dependent echo panel shows it. */
async function expectTokenFlow(page, w, value) {
    await expect.poll(() => w.echoSearchesFor(value).length, {
        timeout: 60000,
        message: `no search dispatched with echoed="${value}"; searches seen: ${JSON.stringify(w.searches.slice(-5))}`,
    }).toBeGreaterThan(0);
    await expect(page.getByText(value, { exact: true }).first()).toBeVisible({ timeout: 60000 });
}

module.exports = {
    APP, HOST_APP, tokenDashboard, putDashboards, watch, login, openAndFindBar,
    expectNoBanner, typeAndSubmit, expectTokenFlow,
};
