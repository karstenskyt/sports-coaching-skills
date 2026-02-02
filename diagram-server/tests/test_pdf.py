"""Tests for PDF compilation."""

import os

import pytest

from soccer_diagrams.pdf_builder import compile_pdf


def test_compile_markdown_only(tmp_path):
    path = compile_pdf(
        title="Test Session",
        sections=[
            {"type": "markdown", "content": "## Warm-Up\n- Jog around pitch\n- Dynamic stretches"},
            {"type": "markdown", "content": "## Main Activity\nPassing drill in 20x15m grid."},
        ],
        output_path=str(tmp_path / "test.pdf"),
    )
    assert os.path.exists(path)
    assert path.endswith(".pdf")
    assert os.path.getsize(path) > 500


def test_compile_with_missing_image(tmp_path):
    """Images that don't exist should be silently skipped."""
    path = compile_pdf(
        title="Test",
        sections=[
            {"type": "markdown", "content": "Some text"},
            {"type": "image", "content": "/nonexistent/image.png", "caption": "Missing"},
        ],
        output_path=str(tmp_path / "test.pdf"),
    )
    assert os.path.exists(path)


def test_default_output_path():
    """When no output_path given, should create in output/pdfs/."""
    path = compile_pdf(
        title="Auto Path Test",
        sections=[{"type": "markdown", "content": "Hello"}],
    )
    assert "output" in path or "pdfs" in path
    assert os.path.exists(path)
    os.remove(path)  # cleanup
