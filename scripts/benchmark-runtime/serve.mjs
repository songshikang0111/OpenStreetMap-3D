// Serves an immutable production SDK bundle and read-only generated samples.
// Keeping the benchmark off Vite HMR makes every sample use the same commit.
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
const bundle=path.resolve(process.argv[2]||'work/runtime-benchmark-site'),fixtures=path.resolve('work/runtime-fixtures'),port=Number(process.env.CITY_BENCHMARK_PORT||5186);
const types={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.cink':'application/octet-stream','.png':'image/png'};
const server=http.createServer(async(req,res)=>{
  try {
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    const isFixture=pathname.startsWith('/work/runtime-fixtures/'),root=isFixture?fixtures:bundle,relative=isFixture?pathname.slice('/work/runtime-fixtures/'.length):pathname.slice(1),file=path.resolve(root,relative,pathname.endsWith('/')?'index.html':'');
    if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    const stat=await fs.stat(file);if(!stat.isFile()){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':'public, max-age=3600'});
    if(req.method==='HEAD')res.end();else createReadStream(file).pipe(res);
  }catch{res.writeHead(404);res.end();}
});
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({pid:process.pid,url:`http://127.0.0.1:${port}/examples/embed/`,bundle,fixtures})));
