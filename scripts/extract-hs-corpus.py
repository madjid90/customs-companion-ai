#!/usr/bin/env python3
"""Conservative, review-first extraction of Moroccan tariff PDF lines.

Uses PDF text only. Never promotes a candidate to the published HS tree.
Every line retains its source file, page, raw text and derivation method.
"""
import argparse
import json
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from pypdf import PdfReader

CHAPTER = re.compile(r'^\s*(?:CHAPITRE|\d+\s*/\s*Chap)\s*(\d{1,2})\b', re.I | re.M)
FULL = re.compile(r'^\s*(?:[0-9]\s+)?(?P<stem>\d{4}\.\d{2})(?:\s+(?P<a>\d{2}))?(?:\s+(?P<b>\d{2}))?(?=\s|$)')
CHILD = re.compile(r'^\s*(?:[0-9]\s+)?(?P<a>\d{2})(?:\s+(?P<b>\d{2}))?\s+[\-–—]')
BARE_HEADING = re.compile(r'^\s*\d{2}\.\d{2}\b\s*')
TRAILING_RATE = re.compile(r'\.{3,}\s*(\d+(?:[,.]\d+)?)\s*(?:kg|u|unit[eé]|m2|m3|l|–|-)?(?:\s|$)', re.I)


def compact(line):
    return re.sub(r'\s+', ' ', line).strip()


def parse_page(lines, chapter, prefix):
    candidates, issues = [], []
    for line_no, raw in enumerate(lines, 1):
        line = compact(raw)
        if not line or len(line) < 4:
            continue
        heading = BARE_HEADING.match(line)
        if heading:
            prefix = None
            line = line[heading.end():].strip()
            if not line:
                continue
        full = FULL.match(line)
        method = None
        if full:
            digits = full['stem'].replace('.', '') + (full['a'] or '') + (full['b'] or '')
            if len(digits) == 10:
                code = digits
                prefix = digits[:8]
                method = 'explicit_10'
            elif len(digits) in (6, 8):
                prefix = digits
                continue
            else:
                issues.append({'type': 'invalid_hs_code', 'line': line_no, 'evidence': line[:180]})
                continue
        else:
            child = CHILD.match(line)
            if not child:
                continue
            suffix = child['a'] + (child['b'] or '')
            if prefix and len(prefix) == 6 and len(suffix) == 2:
                prefix += suffix
                continue
            if prefix and len(prefix) + len(suffix) == 10:
                code = prefix + suffix
                method = 'inherited_prefix'
            else:
                issues.append({'type': 'orphan_hs_code', 'line': line_no, 'evidence': line[:180], 'prefix': prefix})
                continue
        if not re.fullmatch(r'\d{10}', code) or int(code[:2]) not in range(1, 98):
            issues.append({'type': 'invalid_hs_code', 'line': line_no, 'evidence': line[:180], 'candidate': code})
            continue
        if chapter and code[:2] != chapter:
            issues.append({'type': 'chapter_mismatch', 'line': line_no, 'evidence': line[:180], 'candidate': code, 'page_chapter': chapter})
        description = re.sub(r'^[\s\d.]+[\s\d]*', '', line, count=1).strip(' –—-')
        rate = TRAILING_RATE.search(line)
        candidates.append({'code': code, 'chapter': code[:2], 'method': method,
                           'description_fragment': description[:500], 'raw_line': line[:1000],
                           'line_number': line_no, 'duty_rate_candidate': rate.group(1) if rate else None,
                           'confidence': (90 if method == 'explicit_10' else 65) - (20 if chapter and code[:2] != chapter else 0)})
    return candidates, issues, prefix


def extract(entry, root):
    path = root / entry['relative_path']
    output = {'sha256': entry['sha256'], 'relative_path': entry['relative_path'],
              'byte_size': entry['byte_size'], 'status': 'review_required', 'pages': [], 'issues': []}
    try:
        reader = PdfReader(path, strict=False)
        if reader.is_encrypted:
            try:
                reader.decrypt('')
            except Exception as exc:
                output['issues'].append({'type': 'encrypted', 'detail': str(exc)[:200]})
                return output
        chapter = None
        prefix = None
        for page_no, page in enumerate(reader.pages, 1):
            try:
                text = page.extract_text() or ''
            except Exception as exc:
                output['issues'].append({'type': 'page_extraction_failed', 'page': page_no, 'detail': str(exc)[:200]})
                continue
            match = CHAPTER.search(text[:1200])
            if match:
                chapter = match.group(1).zfill(2)
            tariff_page = 'TARIF DES DROITS DE DOUANE' in text.upper()
            page_record = {'page': page_no, 'chars': len(text), 'chapter': chapter,
                           'tariff_table': tariff_page, 'candidates': []}
            if len(text.strip()) < 80:
                output['issues'].append({'type': 'low_text', 'page': page_no, 'chars': len(text.strip())})
            if tariff_page:
                candidates, issues, prefix = parse_page(text.splitlines(), chapter, prefix)
                page_record['candidates'] = candidates
                output['issues'].extend({'page': page_no, **issue} for issue in issues)
            output['pages'].append(page_record)
        codes = [candidate['code'] for page in output['pages'] for candidate in page['candidates']]
        repeated = [code for code, count in Counter(codes).items() if count > 1]
        if repeated:
            output['issues'].append({'type': 'duplicate_codes', 'codes': repeated[:100]})
        if not codes:
            output['issues'].append({'type': 'no_national_lines'})
        output['national_lines'] = len(codes)
        output['unique_codes'] = len(set(codes))
        output['page_count'] = len(reader.pages)
        output['chapters'] = sorted({p['chapter'] for p in output['pages'] if p['chapter']})
        return output
    except Exception as exc:
        output['issues'].append({'type': 'pdf_error', 'detail': str(exc)[:300]})
        return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', default='/Users/souci/Desktop/Document ai ')
    parser.add_argument('--manifest', default='docs/corpus/manifest.json')
    parser.add_argument('--output', default='docs/corpus/hs-extraction-review.json')
    parser.add_argument('--workers', type=int, default=4)
    args = parser.parse_args()
    manifest = json.loads(Path(args.manifest).read_text())
    entries = {row['sha256']: row for row in manifest['documents'] if row['document_type'] == 'tariff'}
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        documents = list(executor.map(lambda row: extract(row, Path(args.root)), entries.values()))
    summary = {'documents': len(documents), 'pages': sum(x.get('page_count', 0) for x in documents),
               'national_line_candidates': sum(x.get('national_lines', 0) for x in documents),
               'unique_code_candidates': len({c['code'] for x in documents for p in x['pages'] for c in p['candidates']}),
               'issue_counts': dict(Counter(issue['type'] for x in documents for issue in x['issues'])),
               'status': 'review_required'}
    Path(args.output).write_text(json.dumps({'summary': summary, 'documents': documents}, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
