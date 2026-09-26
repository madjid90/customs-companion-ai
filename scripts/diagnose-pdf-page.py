#!/usr/bin/env python3
"""Measure one PDF page without deciding its business meaning."""
import argparse, json, sys
import pypdfium2 as pdfium

def main():
    parser=argparse.ArgumentParser(); parser.add_argument("pdf"); parser.add_argument("--page",type=int,required=True); args=parser.parse_args()
    doc=pdfium.PdfDocument(args.pdf); page=doc[args.page-1]
    tp=page.get_textpage(); text=(tp.get_text_range() or "").replace("\x00","").strip(); tp.close()
    counts={"text":0,"image":0,"path":0,"other":0}
    for obj in page.get_objects():
        kind=getattr(obj,"type",None)
        if kind==pdfium.raw.FPDF_PAGEOBJ_TEXT: counts["text"]+=1
        elif kind==pdfium.raw.FPDF_PAGEOBJ_IMAGE: counts["image"]+=1
        elif kind==pdfium.raw.FPDF_PAGEOBJ_PATH: counts["path"]+=1
        else: counts["other"]+=1
    bitmap=page.render(scale=0.7,grayscale=True); image=bitmap.to_pil().convert("L")
    histogram=image.histogram(); pixels=max(1,image.width*image.height); ink=sum(histogram[:245])/pixels
    lowered=text.lower(); table=any(x in lowered for x in ("désignation","quotité","tarif des droits","code sh","unité"))
    form=(text.count("……")+text.count("......")+text.count("____"))>=2
    width,height=page.get_size()
    result={"textCharacters":len(text),"wordCount":len(text.split()),"widthPoints":width,"heightPoints":height,"rotation":page.get_rotation(),"imageObjects":counts["image"],"textObjects":counts["text"],"pathObjects":counts["path"],"otherObjects":counts["other"],"inkRatio":round(ink,6),"hasTableSignals":table,"hasFormSignals":form,"pdfiumVersion":str(pdfium.PDFIUM_INFO)}
    print(json.dumps(result,ensure_ascii=False)); bitmap.close(); page.close(); doc.close()

if __name__=="__main__":
    try: main()
    except Exception as exc: print(json.dumps({"error":f"diagnostic:{exc}"}),file=sys.stderr); raise SystemExit(1)

