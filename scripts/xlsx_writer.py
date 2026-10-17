#!/usr/bin/env python3
"""Scrittore XLSX minimale basato solo sulla libreria standard.

Genera un file .xlsx valido (Open XML) con uno o piu' fogli, senza dipendenze
esterne. Pensato per il download dei dati sul sito.
"""

import re
import zipfile
from xml.sax.saxutils import escape

_ILLEGAL = re.compile(r"[\[\]:*?/\\]")


def _col_letter(index):
    letters = ""
    index += 1
    while index:
        index, rem = divmod(index - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def _sheet_name(name, used):
    clean = _ILLEGAL.sub(" ", str(name)).strip()[:31] or "Foglio"
    candidate, n = clean, 2
    while candidate in used:
        suffix = " (%d)" % n
        candidate = clean[: 31 - len(suffix)] + suffix
        n += 1
    used.add(candidate)
    return candidate


def _cell(col, row, value):
    ref = "%s%d" % (_col_letter(col), row)
    if value is None:
        return ""
    if isinstance(value, bool):
        value = int(value)
    if isinstance(value, (int, float)):
        return '<c r="%s"><v>%s</v></c>' % (ref, value)
    text = escape(str(value))
    return '<c r="%s" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>' % (ref, text)


def _sheet_xml(rows):
    parts = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
        "<sheetData>",
    ]
    for r, row in enumerate(rows, start=1):
        cells = "".join(_cell(c, r, v) for c, v in enumerate(row))
        parts.append('<row r="%d">%s</row>' % (r, cells))
    parts.append("</sheetData></worksheet>")
    return "".join(parts)


def write_xlsx(path, sheets):
    """sheets: lista di (nome, righe) dove righe e' una lista di liste."""
    used = set()
    named = [(_sheet_name(name, used), rows) for name, rows in sheets]

    content_types = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
        '<Default Extension="xml" ContentType="application/xml"/>',
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    ]
    for i in range(len(named)):
        content_types.append(
            '<Override PartName="/xl/worksheets/sheet%d.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' % (i + 1)
        )
    content_types.append("</Types>")

    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        "</Relationships>"
    )

    sheet_tags = "".join(
        '<sheet name="%s" sheetId="%d" r:id="rId%d"/>' % (escape(name), i + 1, i + 1)
        for i, (name, _) in enumerate(named)
    )
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        "<sheets>%s</sheets></workbook>" % sheet_tags
    )

    wb_rels = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ]
    for i in range(len(named)):
        wb_rels.append(
            '<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet%d.xml"/>' % (i + 1, i + 1)
        )
    wb_rels.append("</Relationships>")

    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", "".join(content_types))
        zf.writestr("_rels/.rels", root_rels)
        zf.writestr("xl/workbook.xml", workbook)
        zf.writestr("xl/_rels/workbook.xml.rels", "".join(wb_rels))
        for i, (_, rows) in enumerate(named, start=1):
            zf.writestr("xl/worksheets/sheet%d.xml" % i, _sheet_xml(rows))
