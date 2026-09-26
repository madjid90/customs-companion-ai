#!/usr/bin/env python3
"""Extract one PDF page with PDFium and print a small JSON contract."""

import argparse
import hashlib
import json
import sys

import pypdfium2 as pdfium


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf")
    parser.add_argument("--page", type=int, required=True)
    args = parser.parse_args()
    if args.page < 1:
        raise ValueError("page must be greater than zero")

    document = pdfium.PdfDocument(args.pdf)
    if args.page > len(document):
        raise ValueError(f"page {args.page} exceeds document length {len(document)}")
    page = document[args.page - 1]
    text_page = page.get_textpage()
    text = text_page.get_text_range() or ""
    encoded = text.encode("utf-8")
    print(json.dumps({
        "text": text,
        "text_sha256": hashlib.sha256(encoded).hexdigest(),
        "characters": len(text),
        "engine": "pypdfium2",
        "engine_version": str(pdfium.PYPDFIUM_INFO),
        "pdfium_version": str(pdfium.PDFIUM_INFO),
    }, ensure_ascii=False))
    text_page.close()
    page.close()
    document.close()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # worker consumes this stable error prefix
        print(json.dumps({"error": f"pdfium:{error}"}), file=sys.stderr)
        raise SystemExit(1)
