"""Evaluate session plans for spatial and intensity metrics."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass
class ActivityInput:
    name: str
    area_length: float
    area_width: float
    num_players: int
    duration_minutes: float = 10.0
    intensity: Optional[str] = None  # low/medium/high


@dataclass
class ActivityMetrics:
    name: str
    area_sqm: float
    area_per_player: float
    category: str
    recommendations: list[str]


@dataclass
class SessionEvaluation:
    activities: list[ActivityMetrics]
    overall_recommendations: list[str]
    intensity_profile: list[str]


THRESHOLDS = [
    (20, "very_tight", "Very Tight — suited for 1v1/close-quarters technique drills"),
    (50, "possession", "Possession — good for rondos, small-sided possession games"),
    (100, "game_like", "Game-Like — realistic match spacing, SSGs"),
    (200, "transitions", "Transitions — good for counter-attacks, transition exercises"),
    (float("inf"), "fitness", "Fitness/Open — large area, consider if players need more constraint"),
]


def _categorize(area_per_player: float) -> tuple[str, str]:
    for threshold, category, description in THRESHOLDS:
        if area_per_player < threshold:
            return category, description
    return "fitness", THRESHOLDS[-1][2]


def _recommend(activity: ActivityInput, area_per_player: float, category: str) -> list[str]:
    recs = []
    if area_per_player < 15:
        recs.append(
            f"Very cramped ({area_per_player:.0f}m²/player). "
            "Consider enlarging the area or reducing player count."
        )
    if area_per_player > 250:
        recs.append(
            f"Very spacious ({area_per_player:.0f}m²/player). "
            "Consider shrinking the area to increase engagement."
        )
    if activity.duration_minutes > 20 and category == "very_tight":
        recs.append(
            "Long duration in a tight space may cause fatigue and reduce quality. "
            "Consider splitting into shorter bouts."
        )
    return recs


def evaluate_activity(activity: ActivityInput) -> ActivityMetrics:
    area = activity.area_length * activity.area_width
    app = area / max(activity.num_players, 1)
    category, description = _categorize(app)
    recs = _recommend(activity, app, category)
    return ActivityMetrics(
        name=activity.name,
        area_sqm=area,
        area_per_player=app,
        category=category,
        recommendations=recs,
    )


def evaluate_session(
    pitch_length: float,
    pitch_width: float,
    num_players: int,
    activities: list[dict],
) -> SessionEvaluation:
    results = []
    intensity_profile = []
    for act_data in activities:
        act = ActivityInput(
            name=act_data["name"],
            area_length=act_data.get("area_length", pitch_length),
            area_width=act_data.get("area_width", pitch_width),
            num_players=act_data.get("num_players", num_players),
            duration_minutes=act_data.get("duration_minutes", 10),
            intensity=act_data.get("intensity"),
        )
        metrics = evaluate_activity(act)
        results.append(metrics)
        intensity_profile.append(
            f"{act.name}: {act.intensity or 'medium'} intensity, "
            f"{act.duration_minutes}min, {metrics.category}"
        )

    overall = []
    categories = [r.category for r in results]
    if len(set(categories)) == 1:
        overall.append(
            "All activities use similar spacing. Consider varying area sizes "
            "to challenge players differently."
        )
    if all(a.get("intensity") == "high" for a in activities if a.get("intensity")):
        overall.append(
            "All activities are high intensity. Include recovery or technical "
            "activities to manage load."
        )

    return SessionEvaluation(
        activities=results,
        overall_recommendations=overall,
        intensity_profile=intensity_profile,
    )
