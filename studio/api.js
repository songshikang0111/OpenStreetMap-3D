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
