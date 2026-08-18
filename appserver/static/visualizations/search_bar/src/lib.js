/*
 * Pure logic for the Search Bar viz, extracted so jest can cover it without
 * booting ACE/styled-components. CommonJS on purpose: webpack consumes it via
 * ES import interop and jest requires it directly with no transform.
 */
'use strict';

/* Normalise the many onChange shapes seen across @splunk/react-search
 * components and the native fallback input. */
function valueFromChange(e, data) {
    if (data && typeof data.value !== 'undefined') return data.value;
    if (typeof e === 'string') return e;
    if (e && e.target && typeof e.target.value !== 'undefined') return e.target.value;
    return '';
}

/* Build the triggerDrilldown payload.
 *
 * Studio's parent-side drilldown bridge WHITELISTS payload keys: only `name`,
 * `value`, `_span`, `earliest`, `latest` and FLAT keys literally starting
 * with "row." survive (nested objects are dropped silently). So everything is
 * exposed flat:
 *   value              the typed search text  -> setToken key "value"
 *   earliest / latest  the Bar's time range   -> setToken keys "earliest"/"latest"
 *   row.query.value    alias of value for row-style key paths
 */
function buildDrilldownPayload(tokenName, value, timeRange) {
    const payload = {
        name: tokenName,
        value,
        'row.query.value': value,
    };
    if (timeRange && typeof timeRange.earliest !== 'undefined') {
        payload.earliest = timeRange.earliest;
        payload['row.earliest.value'] = timeRange.earliest;
    }
    if (timeRange && typeof timeRange.latest !== 'undefined') {
        payload.latest = timeRange.latest;
        payload['row.latest.value'] = timeRange.latest;
    }
    return payload;
}

/* Fold a Bar onOptionsChange delta ({search} | {earliest, latest}) into
 * component state. Returns only the keys that changed. */
function applyBarDelta(delta) {
    const next = {};
    if (!delta) return next;
    if (typeof delta.search !== 'undefined') next.value = delta.search;
    if (typeof delta.earliest !== 'undefined' || typeof delta.latest !== 'undefined') {
        next.timeRange = { earliest: delta.earliest, latest: delta.latest };
    }
    return next;
}

module.exports = { valueFromChange, buildDrilldownPayload, applyBarDelta };
