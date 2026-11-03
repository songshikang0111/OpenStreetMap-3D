// Deliberately small, explicit range grammar for offline package contracts.
// Unsupported npm range syntax is rejected rather than silently accepted.
export function versionTuple(version) {
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!m) throw new TypeError(`Invalid stable semantic version: ${version}`);
  return m.slice(1).map(Number);
}
export function satisfies(version, range) {
  const current = versionTuple(version);
  const compare = target => {const t = versionTuple(target); return current[0]-t[0] || current[1]-t[1] || current[2]-t[2];};
  if (typeof range !== 'string' || !range.trim()) throw new TypeError('A compatibility range is required');
  const branches=range.trim().split(/\s*\|\|\s*/).map(branch=>branch.split(/\s+/).map(token=>{
    const m = /^(>=|<=|>|<|=|\^|~)?(\d+\.\d+\.\d+)$/.exec(token);
    if (!m) throw new TypeError(`Unsupported compatibility range token: ${token}`);
    return {op:m[1]||'=',version:m[2],tuple:versionTuple(m[2])};
  }));
  return branches.some(branch=>branch.every(({op,version,tuple:t})=>{
    const cmp=compare(version);
    if(op==='^') return cmp>=0 && (t[0]>0 ? current[0]===t[0] : t[1]>0 ? current[0]===0&&current[1]===t[1] : current[0]===0&&current[1]===0&&current[2]===t[2]);
    if(op==='~') return cmp>=0&&current[0]===t[0]&&current[1]===t[1];
    return op==='>='?cmp>=0:op==='<='?cmp<=0:op==='>'?cmp>0:op==='<'?cmp<0:cmp===0;
  }));
}
