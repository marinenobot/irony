const SDK_VERSION = '12.17.1';
const ROSTER_PATH = 'activeRally/roster';
const MEMBERS_PATH = 'activeRally/members';

export function isSyncConfigured(config){
  return Boolean(config?.apiKey && config?.databaseURL && config?.projectId);
}

async function loadFirebaseSdk(){
  const [app, database] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-database.js`)
  ]);
  return {...app, ...database};
}

/** Transport boundary: plain records in/out, no DOM or browser storage. */
export async function connectRallySync(config, {loadSdk = loadFirebaseSdk} = {}){
  const sdk = await loadSdk();
  const database = sdk.getDatabase(sdk.initializeApp(config));
  const reference = path => sdk.ref(database, path);
  let serverOffsetMs = 0;
  const stopOffset = sdk.onValue(reference('.info/serverTimeOffset'), snapshot => {
    const offset = snapshot.val();
    if(typeof offset === 'number') serverOffsetMs = offset;
  });
  const now = () => Date.now() + serverOffsetMs;

  return {
    now,
    dispose:stopOffset,
    publishRoster:names => sdk.set(reference(ROSTER_PATH), names),
    subscribeRoster(callback){
      return sdk.onValue(reference(ROSTER_PATH), snapshot => {
        const value = snapshot.val();
        const incoming = Array.isArray(value) ? value : (value && typeof value === 'object' ? Object.values(value) : []);
        const seen = new Set();
        callback(incoming.map(value => String(value || '').trim()).filter(name => {
          if(!name) return false;
          const key = name.toLocaleLowerCase('ja-JP');
          if(seen.has(key)) return false;
          seen.add(key);
          return true;
        }));
      });
    },
    subscribeMember(key, callback){
      return sdk.onValue(reference(`${MEMBERS_PATH}/${key}`), snapshot => {
        const value = snapshot.val();
        const departureTime = Number.isFinite(Number(value?.departureTime))
          ? Number(value.departureTime)
          : Date.parse(value?.launchTime || '');
        const impactTime = Number(value?.impactTime);
        callback(value && Number.isFinite(departureTime)
          ? {name:value.name || '', departureTime, impactTime:Number.isFinite(impactTime) ? impactTime : null}
          : null);
      });
    },
    removeMember:key => sdk.remove(reference(`${MEMBERS_PATH}/${key}`)),
    publishDepartures(departures, previousKeys = []){
      const updates = {};
      previousKeys.forEach(key => { updates[key] = null; });
      departures.forEach(({key, name, departureTime, impactTime}) => {
        updates[key] = {
          name,
          departureTime,
          launchTime:new Date(departureTime).toISOString(),
          updatedAt:now()
        };
        if(Number.isFinite(impactTime)) updates[key].impactTime = impactTime;
      });
      return sdk.update(reference(MEMBERS_PATH), updates);
    }
  };
}
