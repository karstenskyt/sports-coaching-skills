"""Tests for tactical diagram rendering."""

import json
import os
import tempfile
from pathlib import Path

import pytest

from soccer_diagrams.renderer import render
from soccer_diagrams.schema import DrillDefinition


@pytest.fixture
def sample_drill():
    fixture_path = Path(__file__).parent / "fixtures" / "sample_drill.json"
    with open(fixture_path) as f:
        return DrillDefinition.model_validate(json.load(f))


def test_render_png(sample_drill, tmp_path):
    path = render(sample_drill, fmt="png", output_dir=str(tmp_path))
    assert os.path.exists(path)
    assert path.endswith(".png")
    assert os.path.getsize(path) > 1000  # non-trivial image


def test_render_pdf(sample_drill, tmp_path):
    path = render(sample_drill, fmt="pdf", output_dir=str(tmp_path))
    assert os.path.exists(path)
    assert path.endswith(".pdf")


def test_render_empty_drill(tmp_path):
    drill = DrillDefinition.model_validate({
        "meta": {"title": "Empty Drill"},
        "elements": [],
        "actions": [],
        "zones": [],
    })
    path = render(drill, output_dir=str(tmp_path))
    assert os.path.exists(path)
