#!/usr/bin/env python3
"""Register every corpus file occurrence without re-uploading PDF bytes.

This preserves provenance for duplicates while source_documents remains
content-addressed and is extracted only once per SHA-256.
"""
import argparse
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def post(endpoint, token, payload):
    request = Request(
        f"{endpoint}?action=asset",
        data=json.dumps(payload, ensure_ascii=False).encode(),
        headers={"content-type": "application/json", "x-corpus-import-token": token},
        method="POST",
    )
    try:
        with urlopen(request, timeout=60) as response:
            return json.loads(response.read())
    except HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code}: {exc.read().decode(errors='replace')[:500]}") from exc


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default="docs/corpus/manifest.json")
    parser.add_argument("--token-file", default=".corpus-import-token.local")
    parser.add_argument("--project-id", default="raygpbajipeyzxfxpbku")
    parser.add_argument("--provider", default="local_filesystem")
    parser.add_argument("--root-external-id", default="Document ai")
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()
    manifest = json.loads(Path(args.manifest).read_text())
    token = Path(args.token_file).read_text().strip()
    endpoint = f"https://{args.project_id}.supabase.co/functions/v1/import-local-corpus"
    def register(row):
        return post(endpoint, token, {
            "provider": args.provider,
            "external_id": row["relative_path"],
            "root_external_id": args.root_external_id,
            "relative_path": row["relative_path"],
            "filename": row["filename"],
            "mime_type": "application/pdf",
            "byte_size": row["byte_size"],
            "sha256": row["sha256"],
            "document_type": row["document_type"],
        })
    completed = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(register, row) for row in manifest["documents"]]
        for future in as_completed(futures):
            result = future.result()
            completed += 1
            if completed % 100 == 0 or completed == len(futures):
                print(f"registered={completed}/{len(futures)} last={result['status']}", flush=True)


if __name__ == "__main__":
    main()
