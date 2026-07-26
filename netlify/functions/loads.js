// Shared storage for the load tracker, backed by Netlify Blobs.
// This is what makes the load list the same across every device -
// instead of each browser keeping its own local copy, everyone reads
// and writes this one store.
//
// No setup needed beyond deploying on Netlify: Netlify automatically
// provisions the Blobs store for the site, no API keys required.

let getStore;
let blobsLoadError = null;
try {
    ({ getStore } = require('@netlify/blobs'));
} catch (err) {
    // If this fails, the @netlify/blobs dependency likely wasn't bundled
    // (missing/misplaced package.json, or the build didn't run npm install).
    // We catch it here so the function can still respond with a useful
    // error instead of dying with an opaque 502 before the handler runs.
    blobsLoadError = err;
}

const STORE_NAME = 'load-tracker';
const KEY = 'loads';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
};

function json(statusCode, data) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify(data)
    };
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: CORS_HEADERS, body: '' };
    }

    if (blobsLoadError) {
        console.error('@netlify/blobs failed to load:', blobsLoadError);
        return json(500, {
            error: `@netlify/blobs did not load: ${blobsLoadError.message}. Check that package.json is at the repo root and the Netlify build ran "npm install".`
        });
    }

    let store;
    try {
        store = getStore(STORE_NAME);

        if (event.httpMethod === 'GET') {
            const loads = (await store.get(KEY, { type: 'json' })) || [];
            return json(200, loads);
        }

        if (event.httpMethod === 'POST') {
            const newLoad = JSON.parse(event.body || '{}');
            if (!newLoad.id) return json(400, { error: 'Missing load id' });

            const loads = (await store.get(KEY, { type: 'json' })) || [];
            loads.unshift(newLoad);
            await store.setJSON(KEY, loads);
            return json(201, newLoad);
        }

        if (event.httpMethod === 'PUT') {
            const id = event.queryStringParameters && event.queryStringParameters.id;
            if (!id) return json(400, { error: 'Missing id query parameter' });

            const updates = JSON.parse(event.body || '{}');
            const loads = (await store.get(KEY, { type: 'json' })) || [];
            const index = loads.findIndex((l) => l.id === id);
            if (index === -1) return json(404, { error: 'Load not found' });

            loads[index] = { ...loads[index], ...updates, id };
            await store.setJSON(KEY, loads);
            return json(200, loads[index]);
        }

        if (event.httpMethod === 'DELETE') {
            const params = event.queryStringParameters || {};
            let loads = (await store.get(KEY, { type: 'json' })) || [];

            if (params.ids) {
                const idSet = new Set(params.ids.split(',').filter(Boolean));
                loads = loads.filter((l) => !idSet.has(l.id));
            } else if (params.id) {
                loads = loads.filter((l) => l.id !== params.id);
            } else {
                return json(400, { error: 'Missing id or ids query parameter' });
            }

            await store.setJSON(KEY, loads);
            return json(200, { success: true });
        }

        return json(405, { error: 'Method not allowed' });
    } catch (err) {
        // Log full detail server-side (visible in Netlify's function log),
        // and also return enough detail in the response body that it shows
        // up in the browser console instead of a bare, unhelpful 502/500.
        console.error('loads function error:', err);
        return json(500, { error: `Server error: ${err.message}`, name: err.name });
    }
};
