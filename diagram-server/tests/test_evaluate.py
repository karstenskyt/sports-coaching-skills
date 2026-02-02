"""Tests for session evaluation metrics."""

import pytest

from soccer_diagrams.evaluator import ActivityInput, evaluate_activity, evaluate_session


def test_tight_space():
    act = ActivityInput(name="1v1", area_length=10, area_width=10, num_players=8)
    metrics = evaluate_activity(act)
    assert metrics.area_per_player == 12.5
    assert metrics.category == "very_tight"


def test_possession_space():
    act = ActivityInput(name="Rondo", area_length=20, area_width=15, num_players=8)
    metrics = evaluate_activity(act)
    assert 20 <= metrics.area_per_player < 50
    assert metrics.category == "possession"


def test_game_like_space():
    act = ActivityInput(name="SSG", area_length=40, area_width=30, num_players=16)
    metrics = evaluate_activity(act)
    assert 50 <= metrics.area_per_player < 100
    assert metrics.category == "game_like"


def test_session_evaluation():
    result = evaluate_session(
        pitch_length=105,
        pitch_width=68,
        num_players=16,
        activities=[
            {"name": "Warm-up Rondo", "area_length": 15, "area_width": 15, "num_players": 6, "intensity": "low"},
            {"name": "Passing Drill", "area_length": 30, "area_width": 20, "num_players": 12, "intensity": "medium"},
            {"name": "Match", "area_length": 60, "area_width": 44, "num_players": 16, "intensity": "high"},
        ],
    )
    assert len(result.activities) == 3
    assert len(result.intensity_profile) == 3
    assert result.activities[0].category == "possession"


def test_cramped_recommendation():
    act = ActivityInput(name="Tight", area_length=5, area_width=5, num_players=10)
    metrics = evaluate_activity(act)
    assert any("cramped" in r.lower() or "enlarg" in r.lower() for r in metrics.recommendations)
