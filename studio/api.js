/** The studio is a client of the local job API; it never fabricates job results. */
export class ApiError extends Error {
  constructor(message, {status, diagnostics = []} = {}) {
    super(message); this.name = 'ApiError'; this.status = status; this.diagnostics = diagnostics;
  }
}

export function createStudioApi({base = '', fetchImpl = globalThis.fetch} = {}) {
  async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetchImpl(`${base}${path}`, {
      method, headers: body === undefined ? {} : {'Content-Type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let value;
    try { value = await response.json(); }
    catch { throw new ApiError(`本地服务返回了无效 JSON（HTTP ${response.status}）。请用 city studio 启动工作台。`, {status:response.status}); }
    if (!response.ok || value.error) {
      const diagnostics = value.diagnostics || (value.error ? [value.error] : []);
      throw new ApiError(value.message || value.error?.message || diagnostics[0]?.message || `HTTP ${response.status}`, {status:response.status, diagnostics});
    }
    return value;
  }
  const id = value => encodeURIComponent(value);
  return {
    search: q => request(`/api/search?q=${encodeURIComponent(q)}`),
    projects: () => request('/api/projects'),
    create: body => request('/api/projects', body),
    open: relativePath => request('/api/projects/open', {relativePath}),
    get: projectId => request(`/api/projects/${id(projectId)}`),
    save: (projectId, config) => request(`/api/projects/${id(projectId)}`, config, 'PATCH'),
    start: (projectId, kind, parameters = {}, resume) => request(`/api/projects/${id(projectId)}/jobs`, {kind, parameters, ...(resume ? {resume} : {})}),
    job: jobId => request(`/api/jobs/${id(jobId)}`),
    cancel: jobId => request(`/api/jobs/${id(jobId)}/cancel`, {}),
  };
}

export const isTerminal = job => ['succeeded', 'failed', 'cancelled'].includes(job.status);

export function areaAround({lat, lon}, radiusMeters = 250) {
  lat = Number(lat); lon = Number(lon); radiusMeters = Number(radiusMeters);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) >= 80 || Math.abs(lon) > 180) throw new Error('请输入有效的非极区 WGS84 坐标。');
  if (!Number.isFinite(radiusMeters) || radiusMeters < 25 || radiusMeters > 2000) throw new Error('半径须在 25–2000 米之间；默认从小街区开始。');
  const dy = radiusMeters / 111320, dx = dy / Math.cos(lat * Math.PI / 180);
  return validateArea({south:lat-dy, west:lon-dx, north:lat+dy, east:lon+dx});
}

export function validateArea(area) {
  const result = Object.fromEntries(['south','west','north','east'].map(key => [key, Number(area[key])]));
  if (Object.values(result).some(x => !Number.isFinite(x)) || result.south >= result.north || result.west >= result.east || result.south <= -80 || result.north >= 80 || result.west < -180 || result.east > 180) throw new Error('范围无效：南须小于北，西须小于东；不支持跨日期变更线或极区。');
  return result;
}

export function viewsForBounds(bounds) {
  let box=bounds;
  if(!Array.isArray(box))box=[...bounds.min,...bounds.max];
  if(box.length===4)box=[box[0],0,box[1],box[2],100,box[3]];
  if(box.length!==6||!box.every(Number.isFinite))throw new Error('场景 bounds 无效。');
  const [x0,y0,z0,x1,y1,z1]=box,cx=(x0+x1)/2,cz=(z0+z1)/2,span=Math.max(x1-x0,z1-z0,100),focus=y0+Math.min(80,Math.max(8,(y1-y0)*.2));
  return {
    overview:{position:[cx+span*.8,y0+span*.8,cz+span*.8],target:[cx,focus,cz]},
    street:{position:[cx+span*.1,y0+12,cz+span*.2],target:[cx,y0+18,cz]},
    skyline:{position:[cx,y0+Math.max(40,(y1-y0)*.3),cz+span],target:[cx,focus,cz]},
  };
}

export function summarizeFeatures(featureIndex={}) {
  const features=Array.isArray(featureIndex)?featureIndex:Object.values(featureIndex),buildings=features.filter(feature=>feature.kind==='building'),heightSources={},recipes=new Set();
  for(const feature of buildings){const source=feature.provenance?.height || feature.heightSource || 'unknown';heightSources[source]=(heightSources[source]||0)+1;if(feature.provenance?.recipeId)recipes.add(feature.atomicGroupId || feature.provenance.recipeId);}
  return {features:features.length,buildings:buildings.length,heightSources,estimatedHeightFraction:buildings.length?(heightSources.estimated||0)/buildings.length:0,landmarkGroups:recipes.size};
}
