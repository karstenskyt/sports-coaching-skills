"""Compile session plans into PDF documents using reportlab.

This renderer provides direct control over PDF layout using reportlab's
platypus library. It supports markdown tables with proper page break handling
(tables split across pages with repeated headers).

Use renderer='reportlab' in compile_to_pdf to select this renderer.
"""

from __future__ import annotations

import os
import re
from datetime import datetime
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Image,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


def _get_styles():
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        "SessionTitle",
        parent=styles["Title"],
        fontSize=22,
        spaceAfter=12,
        textColor=colors.HexColor("#1565C0"),
    ))
    styles.add(ParagraphStyle(
        "SectionHead",
        parent=styles["Heading2"],
        fontSize=14,
        spaceBefore=16,
        spaceAfter=8,
        textColor=colors.HexColor("#212121"),
    ))
    styles.add(ParagraphStyle(
        "BodyText2",
        parent=styles["BodyText"],
        fontSize=11,
        leading=15,
        spaceAfter=8,
    ))
    styles.add(ParagraphStyle(
        "Caption",
        parent=styles["Italic"],
        fontSize=9,
        textColor=colors.HexColor("#757575"),
        alignment=1,  # center
        spaceAfter=12,
    ))
    styles.add(ParagraphStyle(
        "TableCell",
        parent=styles["BodyText"],
        fontSize=9,
        leading=12,
    ))
    styles.add(ParagraphStyle(
        "TableHeader",
        parent=styles["BodyText"],
        fontSize=9,
        leading=12,
        fontName="Helvetica-Bold",
        textColor=colors.HexColor("#1565C0"),
    ))
    return styles


def _parse_markdown_table(lines: list[str], styles) -> Table | None:
    """Parse markdown table lines into a reportlab Table.

    Args:
        lines: List of markdown table lines (header, separator, data rows)
        styles: Reportlab stylesheet with TableCell and TableHeader styles

    Returns:
        A reportlab Table object with repeatRows=1 for proper page breaks,
        or None if the lines don't form a valid markdown table.
    """
    if len(lines) < 2:
        return None

    # Parse header row
    header_line = lines[0].strip()
    if not header_line.startswith("|"):
        return None

    # Check for separator line (|---|---|)
    separator_line = lines[1].strip()
    if not re.match(r'\|[\s\-:|]+\|', separator_line):
        return None

    def parse_row(line: str) -> list[str]:
        """Parse a markdown table row into cells."""
        # Strip leading/trailing pipes and split by pipe
        return [cell.strip() for cell in line.strip("|").split("|")]

    def format_cell(text: str, is_header: bool = False) -> Paragraph:
        """Format cell text with basic markdown support."""
        # Bold markers
        text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
        # Italic markers
        text = re.sub(r'\*(.+?)\*', r'<i>\1</i>', text)
        style = styles["TableHeader"] if is_header else styles["TableCell"]
        return Paragraph(text, style)

    # Build table data
    header_cells = parse_row(header_line)
    table_data = [[format_cell(cell, is_header=True) for cell in header_cells]]

    # Parse data rows (skip separator)
    for line in lines[2:]:
        line = line.strip()
        if not line or not line.startswith("|"):
            break
        row_cells = parse_row(line)
        # Pad row if needed
        while len(row_cells) < len(header_cells):
            row_cells.append("")
        table_data.append([format_cell(cell) for cell in row_cells[:len(header_cells)]])

    # Calculate column widths based on page width
    page_width = A4[0] - 40 * mm  # Account for margins
    num_cols = len(header_cells)
    col_width = page_width / num_cols

    # Create table with repeat header rows for page breaks
    table = Table(table_data, colWidths=[col_width] * num_cols, repeatRows=1)

    # Style the table
    table.setStyle(TableStyle([
        # Header styling
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e3f2fd")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#1565C0")),
        # All cells
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#bdbdbd")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        # Alternating row colors
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fafafa")]),
    ]))

    return table


def _markdown_to_paragraphs(text: str, styles) -> list:
    """Simple markdown-to-reportlab conversion for basic formatting including tables."""
    elements = []
    lines = text.split("\n")
    i = 0

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Check if this line starts a table
        if stripped.startswith("|") and i + 1 < len(lines):
            # Collect all table lines
            table_lines = [stripped]
            j = i + 1
            while j < len(lines) and lines[j].strip().startswith("|"):
                table_lines.append(lines[j].strip())
                j += 1

            # Try to parse as table
            table = _parse_markdown_table(table_lines, styles)
            if table:
                elements.append(Spacer(1, 6))
                elements.append(table)
                elements.append(Spacer(1, 6))
                i = j
                continue

        # Handle horizontal rules
        if stripped in ("---", "***", "___"):
            elements.append(Spacer(1, 8))
            i += 1
            continue

        if not stripped:
            elements.append(Spacer(1, 6))
            i += 1
            continue

        if stripped.startswith("### "):
            elements.append(Paragraph(stripped[4:], styles["SectionHead"]))
        elif stripped.startswith("## "):
            elements.append(Paragraph(stripped[3:], styles["SectionHead"]))
        elif stripped.startswith("# "):
            elements.append(Paragraph(stripped[2:], styles["SessionTitle"]))
        elif stripped.startswith("- ") or stripped.startswith("* "):
            bullet_text = f"• {stripped[2:]}"
            elements.append(Paragraph(bullet_text, styles["BodyText2"]))
        else:
            # Bold markers
            processed = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', stripped)
            # Italic markers
            processed = re.sub(r'\*(.+?)\*', r'<i>\1</i>', processed)
            elements.append(Paragraph(processed, styles["BodyText2"]))

        i += 1

    return elements


def compile_pdf(
    title: str,
    sections: list[dict],
    output_path: str | None = None,
) -> str:
    """Compile sections into a PDF.

    Each section is a dict with:
      - type: "markdown" | "image"
      - content: markdown text or image file path
      - caption: optional caption (for images)

    Returns the output file path.
    """
    if output_path is None:
        output_dir = "output/pdfs"
        Path(output_dir).mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_title = title.replace(" ", "_")[:30]
        output_path = os.path.join(output_dir, f"{safe_title}_{timestamp}.pdf")
    else:
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    styles = _get_styles()
    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
    )

    story = []
    story.append(Paragraph(title, styles["SessionTitle"]))
    story.append(Spacer(1, 12))

    for section in sections:
        if section["type"] == "markdown":
            story.extend(_markdown_to_paragraphs(section["content"], styles))
        elif section["type"] == "image":
            img_path = section["content"]
            if os.path.exists(img_path):
                # Fit image to page width
                max_width = A4[0] - 40 * mm
                img = Image(img_path, width=max_width, height=max_width * 0.6)
                img.hAlign = "CENTER"
                story.append(img)
                if section.get("caption"):
                    story.append(Paragraph(section["caption"], styles["Caption"]))
                story.append(Spacer(1, 8))

    doc.build(story)
    return output_path
