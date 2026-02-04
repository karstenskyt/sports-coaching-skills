"""Convert fixed-width text files to PDF with exact formatting preservation."""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

from reportlab.lib.pagesizes import LETTER, landscape
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


# Page margins
MARGIN_MM = 15
MARGIN = MARGIN_MM * mm

# Default font size range
DEFAULT_FONT_SIZE = 9
MIN_FONT_SIZE = 5
MAX_FONT_SIZE = 12

# Threshold for switching to landscape mode
LANDSCAPE_THRESHOLD_CHARS = 130

# Font registration flag
_font_registered = False
MONO_FONT = "Courier"  # fallback


def _register_unicode_font() -> str:
    """Register a monospace font with Unicode box-drawing support.

    Returns the font name to use.
    """
    global _font_registered, MONO_FONT

    if _font_registered:
        return MONO_FONT

    # Try to find a Unicode-capable monospace font
    font_candidates = []

    if sys.platform == "win32":
        fonts_dir = Path("C:/Windows/Fonts")
        font_candidates = [
            (fonts_dir / "consola.ttf", "Consolas"),
            (fonts_dir / "lucon.ttf", "LucidaConsole"),
            (fonts_dir / "cour.ttf", "CourierNew"),
        ]
    else:
        # Linux/Mac paths
        font_candidates = [
            (Path("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"), "DejaVuSansMono"),
            (Path("/usr/share/fonts/TTF/DejaVuSansMono.ttf"), "DejaVuSansMono"),
            (Path("/System/Library/Fonts/Monaco.ttf"), "Monaco"),
        ]

    for font_path, font_name in font_candidates:
        if font_path.exists():
            try:
                pdfmetrics.registerFont(TTFont(font_name, str(font_path)))
                MONO_FONT = font_name
                _font_registered = True
                return MONO_FONT
            except Exception:
                continue

    # Fallback to Courier (built-in, but no Unicode box chars)
    _font_registered = True
    return MONO_FONT


def _get_max_line_length(text: str) -> int:
    """Find the longest line in the text."""
    lines = text.split("\n")
    return max(len(line) for line in lines) if lines else 0


def _calculate_font_size(
    max_line_chars: int,
    page_width: float,
    margin: float,
) -> float:
    """Calculate font size to fit the longest line within page width."""
    available_width = page_width - (2 * margin)
    # Monospace character width is approximately 0.6 * font size
    char_width_ratio = 0.6

    # Calculate required font size
    if max_line_chars == 0:
        return DEFAULT_FONT_SIZE

    required_size = available_width / (max_line_chars * char_width_ratio)

    # Clamp to reasonable range
    return max(MIN_FONT_SIZE, min(MAX_FONT_SIZE, required_size))


def _get_versioned_path(base_path: str) -> str:
    """Get a versioned file path if the base path already exists."""
    if not os.path.exists(base_path):
        return base_path

    # Extract base name and extension
    path = Path(base_path)
    stem = path.stem
    suffix = path.suffix
    parent = path.parent

    # Check for existing version number pattern
    version_match = re.match(r"(.+)_v(\d+)$", stem)
    if version_match:
        base_stem = version_match.group(1)
        version = int(version_match.group(2))
    else:
        base_stem = stem
        version = 0

    # Find next available version
    while True:
        version += 1
        new_name = f"{base_stem}_v{version}{suffix}"
        new_path = parent / new_name
        if not os.path.exists(new_path):
            return str(new_path)


def text_to_pdf(
    input_path: str,
    output_path: str | None = None,
) -> str:
    """Convert a text file to PDF with fixed-width font.

    Args:
        input_path: Path to the input text file
        output_path: Optional output path. If None, uses same name with .pdf extension
                    in the same directory as input. Won't overwrite - adds version numbers.

    Returns:
        Path to the generated PDF file.
    """
    # Register Unicode-capable font
    font_name = _register_unicode_font()

    # Read input file (keep original Unicode characters)
    with open(input_path, "r", encoding="utf-8") as f:
        text = f.read()

    lines = text.split("\n")
    max_line_chars = _get_max_line_length(text)

    # Determine output path
    if output_path is None:
        input_p = Path(input_path)
        output_path = str(input_p.parent / (input_p.stem + ".pdf"))

    # Get versioned path if file exists
    output_path = _get_versioned_path(output_path)

    # Ensure output directory exists
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    # Switch to landscape if lines are long (> threshold) or font would be too small
    use_landscape = max_line_chars > LANDSCAPE_THRESHOLD_CHARS

    if use_landscape:
        page_width, page_height = landscape(LETTER)
    else:
        page_width, page_height = LETTER

    font_size = _calculate_font_size(max_line_chars, page_width, MARGIN)

    # If still at minimum font size in portrait, try landscape
    if not use_landscape and font_size <= MIN_FONT_SIZE:
        landscape_width, landscape_height = landscape(LETTER)
        landscape_font_size = _calculate_font_size(max_line_chars, landscape_width, MARGIN)
        if landscape_font_size > font_size:
            page_width, page_height = landscape_width, landscape_height
            font_size = landscape_font_size
            use_landscape = True

    # Create PDF
    c = canvas.Canvas(output_path, pagesize=(page_width, page_height))

    # Calculate line height and lines per page
    line_height = font_size * 1.2
    usable_height = page_height - (2 * MARGIN)
    lines_per_page = int(usable_height / line_height)

    # Draw text
    current_line = 0
    total_lines = len(lines)

    while current_line < total_lines:
        # Start new page
        y = page_height - MARGIN - font_size

        # Draw lines for this page
        page_line_count = 0
        while current_line < total_lines and page_line_count < lines_per_page:
            line = lines[current_line]

            # Draw the line
            c.setFont(font_name, font_size)
            c.drawString(MARGIN, y, line)

            y -= line_height
            current_line += 1
            page_line_count += 1

        # Add new page if more content
        if current_line < total_lines:
            c.showPage()

    c.save()
    return output_path


def batch_text_to_pdf(
    input_dir: str,
    output_dir: str | None = None,
    pattern: str = "*.txt",
) -> list[dict]:
    """Convert all matching text files in a directory to PDF.

    Args:
        input_dir: Directory containing text files
        output_dir: Output directory for PDFs. If None, uses input_dir.
        pattern: Glob pattern for input files (default: *.txt)

    Returns:
        List of dicts with input_path, output_path, and status for each file.
    """
    input_path = Path(input_dir)
    if output_dir is None:
        output_path = input_path
    else:
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

    results = []
    for txt_file in input_path.glob(pattern):
        pdf_name = txt_file.stem + ".pdf"
        target_path = output_path / pdf_name

        try:
            result_path = text_to_pdf(str(txt_file), str(target_path))
            results.append({
                "input_path": str(txt_file),
                "output_path": result_path,
                "status": "success",
            })
        except Exception as e:
            results.append({
                "input_path": str(txt_file),
                "output_path": str(target_path),
                "status": "error",
                "error": str(e),
            })

    return results
