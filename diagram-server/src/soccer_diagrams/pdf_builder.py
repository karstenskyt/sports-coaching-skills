"""Compile session plans into PDF documents using reportlab."""

from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch, mm
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
    return styles


def _markdown_to_paragraphs(text: str, styles) -> list:
    """Simple markdown-to-reportlab conversion for basic formatting."""
    elements = []
    for line in text.split("\n"):
        stripped = line.strip()
        if not stripped:
            elements.append(Spacer(1, 6))
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
            processed = stripped.replace("**", "<b>", 1)
            while "**" in processed:
                processed = processed.replace("**", "</b>", 1)
                if "**" in processed:
                    processed = processed.replace("**", "<b>", 1)
            elements.append(Paragraph(processed, styles["BodyText2"]))
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
