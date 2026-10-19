const ORACLE_BASE = 'https://wosoracle.com/api/v1/players/';
const ALLOWED_ORIGINS = [
  'https://submarineride.live',
  'https://www.submarineride.live'
];
const CACHE_SECONDS = 6 * 60 * 60;

function corsHeaders(origin){
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function json(body, status, origin, extra = {}){
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin), ...extra }
  });
}

export default {
  async fetch(request, env, ctx){
    const origin = request.headers.get('Origin') || '';

    if(request.method === 'OPTIONS'){
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if(request.method !== 'GET'){
      return json({ error: 'method_not_allowed' }, 405, origin);
    }
    if(origin && !ALLOWED_ORIGINS.includes(origin)){
      return json({ error: 'forbidden' }, 403, origin);
    }

    const url = new URL(request.url);
    const match = url.pathname.match(/^\/player\/(\d{5,12})$/);
    if(!match){
      return json({ error: 'bad_request' }, 400, origin);
    }
    const id = match[1];
    const refresh = url.searchParams.get('refresh') === '1';

    const cache = caches.default;
    const cacheKey = new Request(`https://player-cache.internal/${id}`);
    if(!refresh){
      const hit = await cache.match(cacheKey);
      if(hit){
        const body = await hit.json();
        return json(body, 200, origin, { 'X-Cache': 'HIT' });
      }
    }

    const upstream = await fetch(ORACLE_BASE + id, {
      headers: { 'Authorization': `Bearer ${env.API_TOKEN}` }
    });

    if(upstream.status === 404){
      return json({ error: 'not_found' }, 404, origin);
    }
    if(upstream.status === 429){
      const retry = upstream.headers.get('Retry-After') || '5';
      return json({ error: 'rate_limited' }, 429, origin, { 'Retry-After': retry });
    }
    if(!upstream.ok){
      return json({ error: 'upstream_error', status: upstream.status }, 502, origin);
    }

    const data = await upstream.json();
    const body = {
      id: String(data.id || id),
      name: data.name || '',
      avatar_url: data.avatar_url || ''
    };

    ctx.waitUntil(cache.put(cacheKey, new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CACHE_SECONDS}` }
    })));

    return json(body, 200, origin, { 'X-Cache': 'MISS' });
  }
};
