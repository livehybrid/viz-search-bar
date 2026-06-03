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

Options: placeholder, buttonLabel, tokenName, initialValue, accentColor.
