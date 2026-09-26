#!/usr/bin/env python3
"""Create review-first page evidence and document classification from local legal PDFs.

No document is marked authoritative or effective by this script. Filenames and PDF
text are untrusted evidence until a reviewer validates the source and dates.
"""
import argparse
import json
import logging
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from pypdf import PdfReader

logging.getLogger('pypdf').setLevel(logging.CRITICAL)
ARTICLE = re.compile(r'\b(?:article|art\.)\s*(\d+(?:\s*(?:bis|ter|quater))?)\b', re.I)
HS_CODE = re.compile(r'(?<!\d)(\d{4}[. ]\d{2}(?:[. ]\d{2}){0,2})(?!\d)')
CIRCULAR = re.compile(r'\b(?:circulaire|note)\s*(?:n[°o]\s*)?([\d]{3,6}(?:[/.-]\d{1,5})?)', re.I)
DATE = re.compile(r'\b(\d{1,2})\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[ûu]t|septembre|octobre|novembre|d[ée]cembre)\s+(20\d{2}|19\d{2})\b', re.I)
TITLE_LINES = re.compile(r'\s+')


def page_evidence(page, number):
    try:
        text = page.extract_text() or ''
        compact = TITLE_LINES.sub(' ', text)
        articles = sorted({m.group(1).replace(' ', '').lower() for m in ARTICLE.finditer(text)})
        codes = sorted({re.sub(r'\D', '', m.group(1)) for m in HS_CODE.finditer(text)})
        codes = [c for c in codes if len(c) in (6, 8, 10) and 1 <= int(c[:2]) <= 97]
        circulars = sorted({m.group(1) for m in CIRCULAR.finditer(text)})
        dates = sorted({m.group(0) for m in DATE.finditer(text)})
        return {'page': number, 'chars': len(text), 'ocr_required': len(text.strip()) < 80,
                'articles_mentioned': articles[:100], 'hs_codes_mentioned': codes[:100],
                'circulars_mentioned': circulars[:50], 'dates_mentioned': dates[:30],
                'opening_text': compact[:600]}
    except Exception as exc:
        return {'page': number, 'chars': 0, 'ocr_required': True, 'error': str(exc)[:200]}


def classify(entry, pages):
    opening = pages[0]['opening_text'].lower() if pages else ''
    proposed = entry['document_type']
    if entry['document_type'] == 'customs_code' or re.match(r'^(?:edition\s+\d{4}\s+)?code des douanes(?:\s+et imp[oô]ts indirects)?\b', opening):
        proposed = 'customs_code'
    elif re.search(r'\bcirculaire\s*(?:n[°o]|\d)', opening[:220]) and proposed in ('agreement', 'regulation'):
        proposed = 'circular'
    return proposed


def extract(entry, root):
    result = {'sha256': entry['sha256'], 'relative_path': entry['relative_path'],
              'folder_type': entry['document_type'], 'status': 'review_required', 'pages': [], 'issues': []}
    try:
        reader = PdfReader(root / entry['relative_path'], strict=False)
        if reader.is_encrypted:
            try:
                reader.decrypt('')
            except Exception as exc:
                result['issues'].append({'type': 'password_required', 'detail': str(exc)[:200]})
                return result
        result['page_count'] = len(reader.pages)
        for number, page in enumerate(reader.pages, 1):
            evidence = page_evidence(page, number)
            result['pages'].append(evidence)
            if evidence['ocr_required']:
                result['issues'].append({'type': 'ocr_required', 'page': number})
            if 'error' in evidence:
                result['issues'].append({'type': 'page_extraction_failed', 'page': number, 'detail': evidence['error']})
        result['document_type_proposed'] = classify(entry, result['pages'])
        if result['document_type_proposed'] != entry['document_type']:
            result['issues'].append({'type': 'type_conflict', 'folder_type': entry['document_type'],
                                     'proposed': result['document_type_proposed']})
        if not any(page['chars'] >= 80 for page in result['pages']):
            result['issues'].append({'type': 'no_extractable_text'})
    except Exception as exc:
        result['issues'].append({'type': 'pdf_error', 'detail': str(exc)[:300]})
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', default='/Users/souci/Desktop/Document ai ')
    parser.add_argument('--manifest', default='docs/corpus/manifest.json')
    parser.add_argument('--output', default='docs/corpus/legal-extraction-review.json')
    parser.add_argument('--workers', type=int, default=8)
    parser.add_argument('--types', nargs='*', default=['customs_code', 'regulation', 'circular', 'agreement', 'technical_control'])
    args = parser.parse_args()
    manifest = json.loads(Path(args.manifest).read_text())
    entries = {row['sha256']: row for row in manifest['documents'] if row['document_type'] in args.types}
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        documents = list(executor.map(lambda entry: extract(entry, Path(args.root)), entries.values()))
    summary = {'documents': len(documents), 'pages': sum(d.get('page_count', 0) for d in documents),
               'issue_counts': dict(Counter(issue['type'] for d in documents for issue in d['issues'])),
               'folder_counts': dict(Counter(d['folder_type'] for d in documents)),
               'proposed_counts': dict(Counter(d.get('document_type_proposed', 'unreadable') for d in documents)),
               'status': 'review_required'}
    Path(args.output).write_text(json.dumps({'summary': summary, 'documents': documents}, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(json.dumps(summary, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
