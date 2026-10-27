"""Split a source file into numbered sections, the unit of citation.

  - Markdown: `##` / `###` headings.
  - Word: paragraphs styled as headings; tables become pipe-separated rows.
  - PDF: numbered heading lines, accepted only when they continue the numbering
    sequence (so numbered lists inside a section are not mistaken for headings),
    after dropping page noise, contents lines and runs of headings with no text
    between them (contents lists / document maps). Margin line numbers are
    stripped for documents whose metadata sets `line_numbers: true`.
"""

import re
from dataclasses import dataclass
from importlib.metadata import version

import pdfplumber
from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph

from app.corpus import Source

PARSERS = {
    "markdown": "markdown-headings/1",
    "pdf": f"pdfplumber {version('pdfplumber')}/1",
    "docx": f"python-docx {version('python-docx')}/1",
}

NUMBERED = re.compile(r"^(\d+(?:\.\d+)*)\.?\s+(\S.*)$")
MD_HEADING = re.compile(r"^#{2,3} (?:(\d+(?:\.\d+)*)\.?\s+)?(.+)$")
ANNEX = re.compile(r"^(?:ANNEX|Annex|APPENDIX|Appendix)\s+[IVX\d]+\b")
PDF_NOISE = [re.compile(r"^\d{1,3}$"), re.compile(r"^page \d+( of \d+)?$", re.I), re.compile(r"\.{4,}\s*\d*$")]
TOC_RUN = 4  # this many heading lines in a row with no text between them = a contents list
MAX_HEADING_LINE = 220  # numbered clauses can be long; the sequence check guards against false headings


@dataclass
class Section:
    number: str | None
    heading: str
    text: str = ""
    page: int | None = None

    @property
    def path(self) -> str:
        return f"{self.number} {self.heading}" if self.number else self.heading


def parse(source: Source) -> list[Section]:
    sections = {"markdown": _parse_markdown, "pdf": _parse_pdf, "docx": _parse_docx}[source.format](source)
    for s in sections:
        s.text = s.text.strip()
    return [s for s in sections if s.text]


# --- Markdown -----------------------------------------------------------------

def _parse_markdown(source: Source) -> list[Section]:
    body = source.path.read_text().split("---\n", 2)[2]
    sections: list[Section] = []
    for line in body.splitlines():
        if m := MD_HEADING.match(line):
            sections.append(Section(m[1], m[2].strip()))
        elif sections:  # text before the first heading (banner, title) is not content
            sections[-1].text += line + "\n"
    return sections


# --- Word ---------------------------------------------------------------------

def _parse_docx(source: Source) -> list[Section]:
    doc = Document(source.path)
    sections: list[Section] = []
    for child in doc.element.body.iterchildren():
        if child.tag.endswith("}p"):
            para = Paragraph(child, doc)
            text = para.text.strip()
            if not text:
                continue
            if para.style is not None and para.style.name.startswith("Heading"):
                m = NUMBERED.match(text)
                sections.append(Section(m[1], m[2].strip()) if m else Section(None, text))
            elif sections:  # the title block before the first heading is metadata, not content
                sections[-1].text += text + "\n"
        elif child.tag.endswith("}tbl") and sections:
            for row in Table(child, doc).rows:
                sections[-1].text += " | ".join(cell.text.strip() for cell in row.cells) + "\n"
    return sections


# --- PDF ----------------------------------------------------------------------

def _pdf_lines(source: Source) -> list[tuple[int, str]]:
    strip_line_numbers = bool(source.meta.get("line_numbers"))
    lines = []
    with pdfplumber.open(source.path) as pdf:
        for page_no, page in enumerate(pdf.pages, start=1):
            for raw in (page.extract_text() or "").splitlines():
                line = raw.strip()
                if strip_line_numbers and not re.match(r"^\d+\.\s", line):
                    line = re.sub(r"^\d{1,3}\s+(?=\S)", "", line)
                if line and not any(p.search(line) for p in PDF_NOISE):
                    lines.append((page_no, line))
    return lines


def _number(text: str) -> tuple[int, ...]:
    return tuple(int(part) for part in text.split("."))


def _continues(prev: tuple[int, ...] | None, cand: tuple[int, ...]) -> bool:
    """True if `cand` can follow `prev` in a numbering scheme (one skipped number tolerated)."""
    if prev is None:
        return cand == (1,)
    if cand[:-1] == prev and cand[-1] in (1, 2):  # first child, e.g. 3 -> 3.1
        return True
    depth = len(cand)  # next sibling at some level, e.g. 4.3 -> 4.4 or 4.3 -> 5
    return depth <= len(prev) and cand[:-1] == prev[:depth - 1] and prev[depth - 1] < cand[-1] <= prev[depth - 1] + 2


def _heading_title(rest: str) -> str:
    if m := re.match(r"^([A-Z][^.]{2,60})\.\s", rest):  # inline heading: "Personnel. In order to ..."
        return m[1]
    if len(rest) <= 80 and not rest.endswith("."):
        return rest
    return " ".join(rest.split()[:8]) + " …"  # numbered clause: title is its opening words


def _parse_pdf(source: Source) -> list[Section]:
    lines = _pdf_lines(source)
    is_candidate = [bool(NUMBERED.match(text)) and len(text) <= MAX_HEADING_LINE for _, text in lines]

    # Drop contents lists: long runs of heading-like lines with no text between them.
    i = 0
    while i < len(lines):
        j = i
        while j < len(lines) and is_candidate[j]:
            j += 1
        if j - i >= TOC_RUN:
            for k in range(i, j):
                is_candidate[k] = None  # neither heading nor body
        i = max(j, i + 1)

    sections = [Section(None, "Preamble", page=1)]
    prev = None
    for (page_no, text), candidate in zip(lines, is_candidate):
        if candidate is None:
            continue
        if prev is not None and ANNEX.match(text):  # annexes after the numbered body get their own section
            sections.append(Section(None, text[:80], page=page_no))
            continue
        m = NUMBERED.match(text) if candidate else None
        if m and _continues(prev, _number(m[1])):
            prev = _number(m[1])
            title = _heading_title(m[2])
            sections.append(Section(m[1], title, "" if title == m[2] else m[2] + "\n", page_no))
        else:
            sections[-1].text += text + "\n"
    return sections
