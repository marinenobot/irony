import { writeFile } from 'node:fs/promises';

const BASE = 'https://wosoracle.com/api/v1';
const TOKEN = process.env.API_TOKEN;
const SEED_ID = process.env.SEED_PLAYER_ID;
const OUTPUT = 'members.json';
const INTERVAL_MS = 700;

if(!TOKEN || !SEED_ID){
  console.error('API_TOKEN and SEED_PLAYER_ID are required');
  process.exit(1);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function get(path){
  for(let attempt = 0; attempt < 3; attempt++){
    const res = await fetch(BASE + path, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if(res.status === 429){
      const wait = Number(res.headers.get('Retry-After') || 5);
      await sleep(wait * 1000);
      continue;
    }
    if(res.status === 404) return null;
    if(!res.ok) throw new Error(`${path} -> ${res.status}`);
    return res.json();
  }
  throw new Error(`${path} -> rate limited`);
}

const seed = await get(`/players/${SEED_ID}?cached=1`);
if(!seed || !seed.alliance) throw new Error('seed player has no alliance');

const alliance = await get(`/alliances/${seed.alliance.id}?kid=${seed.state}`);
if(!alliance) throw new Error('alliance not found');

const players = {};
for(const member of alliance.members || []){
  if(!member.id) continue;
  await sleep(INTERVAL_MS);
  const profile = await get(`/players/${member.id}?cached=1`);
  players[member.id] = {
    name: (profile && profile.name) || member.name || '',
    avatar: (profile && profile.avatar_url) || ''
  };
}

const sorted = Object.fromEntries(Object.entries(players).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(OUTPUT, JSON.stringify({ alliance: alliance.abbr || '', players: sorted }, null, 1) + '\n');
console.log(`${Object.keys(sorted).length} members written`);
