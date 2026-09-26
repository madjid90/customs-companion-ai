#!/usr/bin/env python3
import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
root=Path(sys.argv[1] if len(sys.argv)>1 else os.environ.get('CORPUS_ROOT','/Users/souci/Desktop/Document ai '))
manifest_path=Path(sys.argv[2] if len(sys.argv)>2 else 'docs/corpus/manifest.json')
manifest=json.loads(manifest_path.read_text())
unique={}
for d in manifest['documents']: unique.setdefault(d['sha256'],d)
pdfinfo=os.environ.get('PDFINFO','pdfinfo')
def inspect(d):
 p=root/d['relative_path']
 try:
  r=subprocess.run([pdfinfo,str(p)],capture_output=True,text=True,timeout=15)
  text=r.stdout+r.stderr
  if r.returncode: return {'sha256':d['sha256'],'path':d['relative_path'],'status':'invalid','detail':text[-500:]}
  info={}
  for line in r.stdout.splitlines():
   if ':' in line:
    k,v=line.split(':',1);info[k.strip().lower().replace(' ','_')]=v.strip()
  return {'sha256':d['sha256'],'path':d['relative_path'],'status':'ok','pages':int(info.get('pages','0') or 0),'encrypted':info.get('encrypted','no').lower().startswith('yes'),'tagged':info.get('tagged','no').lower().startswith('yes'),'size':d['byte_size']}
 except Exception as e:return {'sha256':d['sha256'],'path':d['relative_path'],'status':'error','detail':str(e)}
with ThreadPoolExecutor(max_workers=12) as pool: rows=list(pool.map(inspect,unique.values()))
summary={'generated_at':__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),'unique_files':len(rows),'valid':sum(x['status']=='ok' for x in rows),'invalid':sum(x['status']=='invalid' for x in rows),'errors':sum(x['status']=='error' for x in rows),'encrypted':sum(x.get('encrypted',False) for x in rows),'zero_page':sum(x.get('pages',1)==0 for x in rows),'total_pages':sum(x.get('pages',0) for x in rows),'files':rows}
Path('docs/corpus/pdf-audit.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in summary.items() if k!='files'},indent=2))
