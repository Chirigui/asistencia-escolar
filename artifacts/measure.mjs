import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const root=process.argv[2]||'.next';const result={};
for(const route of ['asistencia','login','profesor']){
 const html=fs.readFileSync(path.join(root,'server/app',route+'.html'),'utf8');
 const scripts=[...new Set([...html.matchAll(/src="([^\"]+\.js)"/g)].map(m=>m[1]))];
 const files=scripts.map(s=>path.join(root,s.replace('/_next/','')));
 result[route]={scripts:files.length,bytes:files.reduce((n,f)=>n+fs.statSync(f).size,0),gzip:files.reduce((n,f)=>n+zlib.gzipSync(fs.readFileSync(f)).length,0)};
}
console.log(JSON.stringify(result,null,2));
