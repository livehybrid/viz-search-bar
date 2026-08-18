# viz-search-bar

A Splunk **Dashboard Studio** custom visualization: a Splunk-styled search bar
(`viz-search-bar.search_bar`). On submit (Enter or the **Search** button) it fires
a drilldown carrying the typed text, so a `drilldown.setToken` handler can capture
it into a dashboard token — turning free text into a token that drives other searches.

## Wiring

Add the viz to a Studio dashboard and give it a setToken handler:

```json
"eventHandlers": [
  { "type": "drilldown.setToken",
    "options": { "tokens": [ { "token": "search_query", "key": "value" } ] } }
]
```

Then reference `$search_query$` in any downstream search.

The drilldown payload is flat, matching Studio's parent-side whitelist (only
`name`, `value`, `_span`, `earliest`, `latest` and literal `row.*` keys survive
— nested objects are dropped silently). Available setToken `key`s:

| key | contents |
|---|---|
| `value` (or `row.query.value`) | the typed search text |
| `earliest` (or `row.earliest.value`) | picked time-range start (Bar only) |
| `latest` (or `row.latest.value`) | picked time-range end (Bar only) |

Options: `component` (`bar` = full SearchBar with time picker, `input` = clean
SPL editor), `placeholder`, `buttonLabel`, `tokenName`, `initialValue`,
`accentColor`, `autoSubmitOnLoad`.

**Splunk Enterprise note:** Studio custom visualizations are behind a feature
flag that is off by default on Enterprise (Cloud has it enabled). Add to
`$SPLUNK_HOME/etc/system/local/web-features.conf` and restart:

```ini
[feature:dashboard_studio]
activate_studio_extension_framework = true
```

## Testing

Two layers, both run in CI on every push and gating every release (none of it
ships in the package):

- **Unit (jest)** — `npm test`. Pins the drilldown payload contract (the flat
  whitelist shape above — the nested-payload mistake shipped once and made
  setToken silently never fire), the onChange normalisation, the Bar delta
  handling, and drift guards between `visualizations.conf`, `config.json` and
  the source.
- **End-to-end (Playwright)** — `npm run e2e`. Boots the **freshly built
  package** on a real `splunk/splunk:10.4.0` container, creates a Studio
  dashboard via REST, then drives the real thing in a headless browser: types
  into the ACE editor, presses Enter and asserts the token flows into a
  dependent panel — plus a render screenshot artifact.
