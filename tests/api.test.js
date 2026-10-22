import test from 'node:test';
import assert from 'node:assert/strict';
import {connectRallySync} from '../js/api/rally-sync.js';
import {createPlayerApi} from '../js/api/players.js';

test('rally adapter preserves the shared database contract and unsubscribe behavior', async () => {
  const listeners = new Map();
  const writes = [];
  const sdk = {
    initializeApp:config => config,
    getDatabase:app => app,
    ref:(_database, path) => path,
    onValue(path, callback){
      listeners.set(path, callback);
      return () => listeners.delete(path);
    },
    set:async (path, value) => writes.push({path, value}),
    update:async (path, value) => writes.push({path, value}),
    remove:async path => writes.push({path, removed:true})
  };
  const api = await connectRallySync({}, {loadSdk:async () => sdk});
  const snapshot = value => ({val:() => value});
  listeners.get('.info/serverTimeOffset')(snapshot(1000));
  assert.ok(Math.abs(api.now() - Date.now() - 1000) < 50);
  let roster;
  const stop = api.subscribeRoster(value => { roster = value; });
  listeners.get('activeRally/roster')(snapshot({0:' Kai ', 1:'kai', 2:'マリン', 3:''}));
  assert.deepEqual(roster, ['Kai', 'マリン']);
  await api.publishRoster(['Kai']);
  assert.deepEqual(writes.at(-1), {path:'activeRally/roster', value:['Kai']});
  const departureTime = Date.parse('2026-10-22T12:00:00Z');
  const key = encodeURIComponent('マリン');
  await api.publishDepartures([{key, name:'マリン', departureTime}], [key, 'Old']);
  assert.equal(writes.at(-1).path, 'activeRally/members');
  assert.equal(writes.at(-1).value.Old, null);
  assert.deepEqual({...writes.at(-1).value[key], updatedAt:0}, {
    name:'マリン', departureTime, launchTime:'2026-10-22T12:00:00.000Z', updatedAt:0
  });
  let member;
  const stopMember = api.subscribeMember(key, value => { member = value; });
  listeners.get(`activeRally/members/${key}`)(snapshot({departureTime}));
  assert.deepEqual(member, {name:'', departureTime});
  listeners.get(`activeRally/members/${key}`)(snapshot({name:'マリン', launchTime:'2026-10-22T12:00:00Z'}));
  assert.deepEqual(member, {name:'マリン', departureTime});
  listeners.get(`activeRally/members/${key}`)(snapshot({departureTime:'invalid'}));
  assert.equal(member, null);
  await api.removeMember(key);
  assert.deepEqual(writes.at(-1), {path:`activeRally/members/${key}`, removed:true});
  stop(); stopMember(); api.dispose();
  assert.equal(listeners.size, 0);
});

test('player service normalizes upstream data without knowing a screen', async () => {
  const api = createPlayerApi({fetchImpl:async () => new Response(JSON.stringify({name:'Kai', avatar_url:'avatar.png'}))});
  assert.deepEqual(await api.getPlayer('123456'), {name:'Kai', avatar:'avatar.png'});
});

test('player service preserves not-found and cached directory fallback behavior', async () => {
  const missing = createPlayerApi({fetchImpl:async () => new Response('', {status:404})});
  assert.equal(await missing.getPlayer('123456'), null);
  let directoryReads = 0;
  const fallback = createPlayerApi({fetchImpl:async url => {
    if(url === 'members.json'){
      directoryReads++;
      return new Response(JSON.stringify({players:{123456:{name:'Kai', avatar:''}}}));
    }
    throw new Error('offline');
  }});
  assert.equal((await fallback.getPlayer('123456')).name, 'Kai');
  assert.equal((await fallback.getPlayer('123456')).name, 'Kai');
  assert.equal(directoryReads, 1);
});

test('failed directory requests can be retried', async () => {
  let attempts = 0;
  const api = createPlayerApi({fetchImpl:async url => {
    if(url !== 'members.json') throw new Error('offline');
    attempts++;
    if(attempts === 1) throw new Error('offline');
    return new Response(JSON.stringify({players:{123456:{name:'Recovered'}}}));
  }});
  await assert.rejects(api.getPlayer('123456'));
  assert.equal((await api.getPlayer('123456')).name, 'Recovered');
});
