import argparse
import json
from pathlib import Path

import openpyxl


def clean(value):
    return "" if value is None else str(value).strip()


def main():
    parser = argparse.ArgumentParser(description="Convert the verified reference workbook to a browser module.")
    parser.add_argument("source")
    parser.add_argument("output")
    args = parser.parse_args()

    workbook = openpyxl.load_workbook(args.source, read_only=True, data_only=True)
    sheet = workbook["全部文献"]
    headers = [cell.value for cell in sheet[1]]
    records = []
    for row in sheet.iter_rows(min_row=2, values_only=True):
        if not row[0]:
            continue
        source = dict(zip(headers, row))
        records.append({
            "id": f"lib-{int(source['编号'])}",
            "type": clean(source["文献类型"]),
            "direction": clean(source["方向"]),
            "language": clean(source["语言"]),
            "year": int(source["年份"]) if source["年份"] else 0,
            "authors": clean(source["作者"]),
            "title": clean(source["题名"]),
            "source": clean(source["期刊/出版项/来源"]),
            "publication": clean(source["卷期页码/出版信息"]),
            "identifier": clean(source["DOI/标准号/专利号/ISBN"]),
            "formatted": clean(source["GB/T 7714—2015引用"]),
            "url": clean(source["核验链接"]),
            "verification": clean(source["核验方式"]),
            "citationCount": int(source["Crossref引用次数"] or 0),
            "topics": clean(source["适用课题"]),
        })

    payload = json.dumps(records, ensure_ascii=False, separators=(",", ":"))
    content = (
        "// Generated from the verified GB/T 7714 workbook. Do not edit by hand.\n"
        f"export const REFERENCE_LIBRARY = Object.freeze({payload});\n"
        f"export const REFERENCE_LIBRARY_META = Object.freeze({{count:{len(records)},updatedAt:'2026-08-26'}});\n"
    )
    Path(args.output).write_text(content, encoding="utf-8")


if __name__ == "__main__":
    main()
