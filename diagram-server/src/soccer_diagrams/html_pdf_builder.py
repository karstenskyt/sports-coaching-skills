"""Compile session plans into PDF documents via HTML rendering.

Uses markdown library for proper markdown-to-HTML conversion (including tables)
and xhtml2pdf for PDF output with CSS styling.
"""

from __future__ import annotations

import base64
import os
from datetime import datetime
from pathlib import Path

import markdown
from xhtml2pdf import pisa

# CSS stylesheet for the PDF - minimal xhtml2pdf compatible
PDF_STYLESHEET = """
@page {
    size: A4;
    margin: 18mm;
}

body {
    font-family: Helvetica, Arial, sans-serif;
    font-size: 10pt;
    line-height: 1.4;
    color: #212121;
}

h1 {
    font-size: 20pt;
    color: #1565C0;
    margin-bottom: 10pt;
    border-bottom: 2px solid #1565C0;
    padding-bottom: 5pt;
}

h2 {
    font-size: 14pt;
    color: #1976D2;
    margin-top: 14pt;
    margin-bottom: 8pt;
}

h3 {
    font-size: 12pt;
    color: #424242;
    margin-top: 10pt;
    margin-bottom: 6pt;
}

p {
    margin-bottom: 6pt;
}

ul, ol {
    margin-bottom: 8pt;
    padding-left: 18pt;
}

li {
    margin-bottom: 3pt;
}

table {
    width: 100%;
    border-collapse: collapse;
    margin: 8pt 0;
    font-size: 9pt;
}

th, td {
    border: 1px solid #9e9e9e;
    padding: 5pt 6pt;
    text-align: left;
    vertical-align: top;
}

th {
    background-color: #e3f2fd;
    font-weight: bold;
    color: #1565C0;
}

.status-pass {
    color: #2e7d32;
    font-weight: bold;
}

.status-fail {
    color: #c62828;
    font-weight: bold;
}

.status-warning {
    color: #f57c00;
    font-weight: bold;
}

.figure {
    margin: 12pt 0;
    text-align: center;
}

.figure img {
    max-width: 100%;
}

.figcaption {
    font-size: 8pt;
    color: #757575;
    font-style: italic;
    margin-top: 5pt;
}

hr {
    border: none;
    border-top: 1px solid #e0e0e0;
    margin: 12pt 0;
}

strong, b {
    font-weight: bold;
}

em, i {
    font-style: italic;
}
"""


def _process_status_icons(html: str) -> str:
    """Convert emoji status icons to styled text for better PDF rendering."""
    replacements = [
        ("✅", '<span class="status-pass">[PASS]</span>'),
        ("❌", '<span class="status-fail">[FAIL]</span>'),
        ("⚠️", '<span class="status-warning">[WARN]</span>'),
        ("⚠", '<span class="status-warning">[WARN]</span>'),
    ]
    for emoji, replacement in replacements:
        html = html.replace(emoji, replacement)
    return html


def _embed_images_base64(html: str, base_path: str | None = None) -> str:
    """Convert image paths to base64 data URIs for embedding in HTML."""
    import re

    def replace_img(match):
        img_tag = match.group(0)
        src_match = re.search(r'src=["\']([^"\']+)["\']', img_tag)
        if not src_match:
            return img_tag

        src = src_match.group(1)

        # Skip already embedded images or URLs
        if src.startswith('data:') or src.startswith('http'):
            return img_tag

        # Resolve path
        if base_path and not os.path.isabs(src):
            img_path = os.path.join(base_path, src)
        else:
            img_path = src

        if not os.path.exists(img_path):
            return img_tag

        # Determine MIME type
        ext = os.path.splitext(img_path)[1].lower()
        mime_types = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
        }
        mime_type = mime_types.get(ext, 'image/png')

        # Read and encode
        with open(img_path, 'rb') as f:
            data = base64.b64encode(f.read()).decode('utf-8')

        data_uri = f'data:{mime_type};base64,{data}'
        return img_tag.replace(src_match.group(0), f'src="{data_uri}"')

    return re.sub(r'<img[^>]+>', replace_img, html)


def _markdown_to_html(text: str) -> str:
    """Convert markdown to HTML with table support."""
    md = markdown.Markdown(extensions=['tables', 'fenced_code', 'nl2br'])
    html = md.convert(text)
    return _process_status_icons(html)


def compile_pdf_html(
    title: str,
    sections: list[dict],
    output_path: str | None = None,
) -> str:
    """Compile sections into a PDF via HTML rendering.

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

    # Build HTML content
    html_parts = [f"<h1>{title}</h1>"]

    for i, section in enumerate(sections):
        if section["type"] == "markdown":
            section_html = _markdown_to_html(section["content"])
            # No wrapper div - let content flow naturally
            html_parts.append(section_html)

        elif section["type"] == "image":
            img_path = section["content"]
            if os.path.exists(img_path):
                caption = section.get("caption", "")
                html_parts.append(f'''
                <div class="figure">
                    <img src="{img_path}">
                    {f'<div class="figcaption">{caption}</div>' if caption else ''}
                </div>
                ''')

    html_content = "\n".join(html_parts)

    # Embed images as base64
    html_content = _embed_images_base64(html_content)

    full_html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>{title}</title>
    <style>
    {PDF_STYLESHEET}
    </style>
</head>
<body>
{html_content}
</body>
</html>
"""

    # Convert to PDF using xhtml2pdf
    with open(output_path, "wb") as pdf_file:
        pisa_status = pisa.CreatePDF(
            src=full_html,
            dest=pdf_file,
            encoding='utf-8',
        )

    if pisa_status.err:
        raise RuntimeError(f"PDF generation failed with {pisa_status.err} errors")

    return output_path


def compile_html(
    title: str,
    sections: list[dict],
    output_path: str | None = None,
) -> str:
    """Compile sections into a standalone HTML file.

    Each section is a dict with:
      - type: "markdown" | "image"
      - content: markdown text or image file path
      - caption: optional caption (for images)

    Returns the output file path.
    """
    if output_path is None:
        output_dir = "output/html"
        Path(output_dir).mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_title = title.replace(" ", "_")[:30]
        output_path = os.path.join(output_dir, f"{safe_title}_{timestamp}.html")
    else:
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    # Build HTML content
    html_parts = [f"<h1>{title}</h1>"]

    for section in sections:
        if section["type"] == "markdown":
            section_html = _markdown_to_html(section["content"])
            html_parts.append(f'<div class="section">{section_html}</div>')

        elif section["type"] == "image":
            img_path = section["content"]
            if os.path.exists(img_path):
                caption = section.get("caption", "")
                html_parts.append(f'''
                <div class="figure">
                    <img src="{img_path}">
                    {f'<div class="figcaption">{caption}</div>' if caption else ''}
                </div>
                ''')

    html_content = "\n".join(html_parts)
    html_content = _embed_images_base64(html_content)

    # For standalone HTML, add screen-friendly styles
    screen_styles = """
    body {
        max-width: 800px;
        margin: 40px auto;
        padding: 20px;
        background-color: #fff;
    }
    @media print {
        body { margin: 0; padding: 0; max-width: none; }
    }
    """

    full_html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>{title}</title>
    <style>
    {PDF_STYLESHEET}
    {screen_styles}
    </style>
</head>
<body>
{html_content}
</body>
</html>
"""

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(full_html)

    return output_path
