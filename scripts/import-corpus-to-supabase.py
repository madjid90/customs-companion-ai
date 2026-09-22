#!/usr/bin/env python3
"""Upload the local PDF corpus and native page text through a short-lived import endpoint.

The token is read from a local 0600 file. Neither the token nor full page text is
written to the progress log. Every imported document stays in quality review.
"""
import argparse
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from pypdf import PdfReader
import pypdfium2 as pdfium

logging.getLogger("pypdf").setLevel(logging.CRITICAL)


def extract_pages(path):
    """Use PDFium when pypdf cannot parse a file or misses an embedded text layer."""
    try:
        reader = PdfReader(path, strict=False)
        if reader.is_encrypted and not reader.decrypt(""):
            raise RuntimeError("Encrypted PDF requires password or alternative source")
        texts = []
        for page in reader.pages:
            try:
                texts.append((page.extract_text() or "").strip())
            except Exception:
                texts.append("")
    except Exception:
        texts = None

    if texts is None or any(len(text) < 80 for text in texts):
        document = pdfium.PdfDocument(path)
        if texts is None or len(texts) != len(document):
            texts = [""] * len(document)
        for index, text in enumerate(texts):
            if len(text) >= 80:
                continue
            page = document.get_page(index)
            try:
                textpage = page.get_textpage()
                try:
                    candidate = textpage.get_text_range().strip()
                finally:
                    textpage.close()
                if len(candidate) > len(text):
                    texts[index] = candidate
            finally:
                page.close()
        document.close()
    return texts


def request(endpoint, token, action, payload, headers=None, attempts=3):
    headers = {"x-corpus-import-token": token, **(headers or {})}
    if isinstance(payload, bytes):
        headers["content-type"] = "application/pdf"
        body = payload
    else:
        headers["content-type"] = "application/json"
        body = json.dumps(payload, ensure_ascii=False).encode()
    for attempt in range(attempts):
        try:
            req = Request(f"{endpoint}?action={action}", data=body, headers=headers, method="POST")
            with urlopen(req, timeout=120) as response:
                return json.loads(response.read())
        except HTTPError as exc:
            detail = exc.read().decode(errors="replace")[:500]
            if exc.code < 500 or attempt == attempts - 1:
                raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc
        except (URLError, TimeoutError) as exc:
            if attempt == attempts - 1:
                raise RuntimeError(f"Network error: {exc}") from exc
        time.sleep(2 ** attempt)
    raise RuntimeError("Request failed")


def import_one(row, root, endpoint, token):
    path = root / row["relative_path"]
    body = path.read_bytes()
    response = request(endpoint, token, "file", body, {
        "x-file-sha256": row["sha256"],
        "x-relative-path": quote(row["relative_path"], safe=""),
        "x-document-type": row["document_type"] if row["document_type"] in {
            "customs_code", "law", "decree", "order", "circular", "instruction", "tariff",
            "agreement", "origin_rule", "procedure", "authorization", "technical_control",
            "tax_rule", "guide"
        } else "other",
    })
    if response["status"] == "duplicate":
        return {"sha256": row["sha256"], "path": row["relative_path"], "status": "duplicate"}
    run_id = response["run_id"]
    texts = extract_pages(path)
    pages = []
    empty = 0
    for number, text in enumerate(texts, 1):
        if len(text) < 80:
            empty += 1
        pages.append({"number": number, "text": text})
        if len(pages) == 20:
            request(endpoint, token, "pages", {"run_id": run_id, "pages": pages})
            pages = []
    if pages:
        request(endpoint, token, "pages", {"run_id": run_id, "pages": pages})
    result = request(endpoint, token, "complete", {"run_id": run_id, "total_pages": len(texts)})
    return {"sha256": row["sha256"], "path": row["relative_path"], "status": result["status"], "pages": len(texts), "pages_requiring_review": empty}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="/Users/souci/Desktop/Document ai ")
    parser.add_argument("--manifest", default="docs/corpus/manifest.json")
    parser.add_argument("--token-file", default=".corpus-import-token.local")
    parser.add_argument("--progress", default="docs/corpus/import-progress.local")
    parser.add_argument("--project-id", default="raygpbajipeyzxfxpbku")
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    manifest = json.loads(Path(args.manifest).read_text())
    token = Path(args.token_file).read_text().strip()
    endpoint = f"https://{args.project_id}.supabase.co/functions/v1/import-local-corpus"
    progress_path = Path(args.progress)
    progress_path.parent.mkdir(parents=True, exist_ok=True)
    completed = set()
    if progress_path.exists():
        for line in progress_path.read_text().splitlines():
            try:
                item = json.loads(line)
                if item.get("status") in ("quality_review", "duplicate"):
                    completed.add(item["sha256"])
            except (ValueError, KeyError):
                pass
    unique = {item["sha256"]: item for item in manifest["documents"]}
    pending = [item for sha, item in unique.items() if sha not in completed]
    if args.limit:
        pending = pending[:args.limit]
    print(f"Unique PDFs: {len(unique)} | already loaded: {len(completed)} | this run: {len(pending)}", flush=True)
    succeeded = failed = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool, progress_path.open("a") as progress:
        futures = {pool.submit(import_one, row, Path(args.root), endpoint, token): row for row in pending}
        for future in as_completed(futures):
            row = futures[future]
            try:
                result = future.result()
                succeeded += 1
            except Exception as exc:
                result = {"sha256": row["sha256"], "path": row["relative_path"], "status": "failed", "error": str(exc)[:500]}
                failed += 1
            progress.write(json.dumps(result, ensure_ascii=False) + "\n")
            progress.flush()
            if (succeeded + failed) % 10 == 0 or result["status"] == "failed":
                print(f"processed={succeeded + failed}/{len(pending)} ok={succeeded} failed={failed} latest={result['path']} status={result['status']}", flush=True)
    print(f"Finished: ok={succeeded} failed={failed}", flush=True)


if __name__ == "__main__":
    main()
