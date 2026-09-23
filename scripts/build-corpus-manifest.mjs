import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || process.env.CORPUS_ROOT || '/Users/souci/Desktop/Document ai ');
const output = path.resolve(process.argv[3] || 'docs/corpus/manifest.json');
function categoryFor(folder) {
  const value = folder.normalize('NFD').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  if (value.includes('sh code')) return 'tariff';
  if (value.includes('circulaire')) return 'circular';
  if (value.includes('code de la douane')) return 'customs_code';
  if (value.includes('reglementation des douanes')) return 'regulation';
  if (value.includes('accord')) return 'agreement';
  if (value.includes('produits controles')) return 'technical_control';
  return 'other';
}
async function walk(dir) { const out=[]; for (const entry of await fs.readdir(dir,{withFileTypes:true})) { if(entry.name.startsWith('.')) continue; const full=path.join(dir,entry.name); if(entry.isDirectory()) out.push(...await walk(full)); else if(entry.name.toLowerCase().endsWith('.pdf')) out.push(full); } return out; }
function hashFile(file){return new Promise((resolve,reject)=>{const h=createHash('sha256');createReadStream(file).on('error',reject).on('data',d=>h.update(d)).on('end',()=>resolve(h.digest('hex')));});}
const files=await walk(root); const records=[];
for(let i=0;i<files.length;i++){const file=files[i];const stat=await fs.stat(file);const relative=path.relative(root,file);const folder=relative.split(path.sep)[0];records.push({relative_path:relative,filename:path.basename(file),document_type:categoryFor(folder),byte_size:stat.size,sha256:await hashFile(file)});if((i+1)%100===0)process.stderr.write(`\r${i+1}/${files.length}`);}
const byHash=new Map();for(const r of records){const list=byHash.get(r.sha256)||[];list.push(r.relative_path);byHash.set(r.sha256,list);}
const duplicates=[...byHash.entries()].filter(([,v])=>v.length>1).map(([sha256,paths])=>({sha256,paths}));
const counts=Object.fromEntries(Object.entries(records.reduce((a,r)=>({...a,[r.document_type]:(a[r.document_type]||0)+1}),{})).sort());
const manifest={generated_at:new Date().toISOString(),root_label:path.basename(root),total_files:records.length,total_bytes:records.reduce((n,r)=>n+r.byte_size,0),unique_contents:byHash.size,duplicate_groups:duplicates.length,duplicate_instances:records.length-byHash.size,counts,duplicates,documents:records};
await fs.writeFile(output,JSON.stringify(manifest,null,2)+'\n');process.stderr.write(`\nWrote ${output}\n`);
