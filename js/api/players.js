import {PLAYER_LOOKUP_URL, ORACLE_PLAYER_URL, ORACLE_TOKEN} from '../config.js';

/** Returns {name, avatar} or null; transport failures reject. No DOM access. */
export function createPlayerApi({fetchImpl = globalThis.fetch} = {}){
  async function fetchOraclePlayer(id){
    const res = await fetchImpl(`${ORACLE_PLAYER_URL}${id}`, {
      headers: {Authorization: `Bearer ${ORACLE_TOKEN}`}
    });
    if(res.status === 404) return null;
    if(!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    return {name: data.name || '', avatar: data.avatar_url || ''};
  }
  let memberDirectoryPromise = null;

  function loadMemberDirectory(){
    if(!memberDirectoryPromise){
      memberDirectoryPromise = fetchImpl(PLAYER_LOOKUP_URL, {cache:'no-cache'})
        .then(res => {
          if(!res.ok) throw new Error(String(res.status));
          return res.json();
        })
        .then(data => data.players || {})
        .catch(error => {
          memberDirectoryPromise = null;
          throw error;
        });
    }
    return memberDirectoryPromise;
  }

  async function getPlayer(id){
    try{
      return await fetchOraclePlayer(id);
    }catch(error){
      const directory = await loadMemberDirectory();
      return directory[id] || null;
    }
  }
  return {getPlayer};
}
