import http from 'node:http';
import path from 'node:path';
import {realpath,readFile,stat} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export async function createStaticServer(directory,{port=0}={}) {
  const root=await realpath(directory),mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.glb':'model/gltf-binary'};
  const server=http.createServer(async(req,res)=>{
    try {
      if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
      const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1);
      let file=await realpath(path.join(root,relative));
      if(file!==root&&!file.startsWith(root+path.sep))throw new Error('outside root');
      if((await stat(file)).isDirectory())file=await realpath(path.join(file,'index.html'));
      if(!file.startsWith(root+path.sep))throw new Error('outside root');
      const bytes=await readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':bytes.length,'X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);
    }catch{res.writeHead(404);res.end('Not found');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {server,url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const args=process.argv.slice(2),index=args.indexOf('--port'),port=index<0?4180:Number(args[index+1]);
  const service=await createStaticServer(path.resolve(args[0]||'.'),{port});
  console.log(`Static City Ink site: ${service.url}`);
  process.once('SIGINT',()=>service.close());process.once('SIGTERM',()=>service.close());
}
