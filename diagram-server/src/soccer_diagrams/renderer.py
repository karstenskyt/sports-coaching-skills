"""Render tactical diagrams using mplsoccer."""

from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.patches as mpatches
import matplotlib.pyplot as plt
from mplsoccer import Pitch

from .schema import (
    ActionType,
    DrillDefinition,
    MarkerType,
    PitchView,
    Team,
    ZoneType,
)

# Default team colors
TEAM_COLORS = {
    Team.home: "#1565C0",
    Team.away: "#C62828",
    Team.neutral: "#F9A825",
}

MARKER_SHAPES = {
    MarkerType.jersey: "o",
    MarkerType.cone: "^",
    MarkerType.ball: "h",
    MarkerType.dot: ".",
}

ACTION_STYLES = {
    ActionType.pass_: {"linestyle": "-", "color": "#1565C0"},
    ActionType.run: {"linestyle": "--", "color": "#2E7D32"},
    ActionType.dribble: {"linestyle": "-.", "color": "#F57F17"},
    ActionType.shot: {"linestyle": "-", "color": "#C62828"},
    ActionType.curved_run: {"linestyle": "--", "color": "#6A1B9A"},
}


def _get_pitch(view: PitchView) -> Pitch:
    if view == PitchView.half:
        return Pitch(half=True, pitch_color="grass", line_color="white")
    if view == PitchView.attacking_third:
        return Pitch(half=True, pitch_color="grass", line_color="white")
    return Pitch(pitch_color="grass", line_color="white")


def _resolve_target(action, elements_by_id: dict) -> tuple[float, float] | None:
    if action.to_id and action.to_id in elements_by_id:
        target = elements_by_id[action.to_id]
        return target.x, target.y
    if action.to_x is not None and action.to_y is not None:
        return action.to_x, action.to_y
    return None


def render(drill: DrillDefinition, fmt: str = "png", output_dir: str = "output/diagrams") -> str:
    """Render a drill definition to an image file. Returns the file path."""
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    pitch = _get_pitch(drill.meta.pitch_view)
    fig, ax = pitch.draw(figsize=(12, 8))
    ax.set_title(drill.meta.title, fontsize=16, fontweight="bold", pad=12)

    elements_by_id: dict = {e.id: e for e in drill.elements}

    # Draw zones first (background)
    for zone in drill.zones:
        if zone.type == ZoneType.rect and zone.width and zone.height:
            rect = mpatches.FancyBboxPatch(
                (zone.x, zone.y),
                zone.width,
                zone.height,
                boxstyle="round,pad=1",
                facecolor=zone.color or "#2196F3",
                alpha=zone.alpha,
                edgecolor="none",
            )
            ax.add_patch(rect)
            if zone.label:
                ax.text(
                    zone.x + zone.width / 2,
                    zone.y + zone.height / 2,
                    zone.label,
                    ha="center",
                    va="center",
                    fontsize=9,
                    color="white",
                    fontweight="bold",
                )
        elif zone.type == ZoneType.circle and zone.radius:
            circle = mpatches.Circle(
                (zone.x, zone.y),
                zone.radius,
                facecolor=zone.color or "#2196F3",
                alpha=zone.alpha,
                edgecolor="none",
            )
            ax.add_patch(circle)
            if zone.label:
                ax.text(
                    zone.x, zone.y, zone.label,
                    ha="center", va="center", fontsize=9,
                    color="white", fontweight="bold",
                )

    # Draw players
    for elem in drill.elements:
        color = elem.color or TEAM_COLORS.get(elem.team, "#333333")
        marker = MARKER_SHAPES.get(elem.marker, "o")
        size = 300 if elem.marker == MarkerType.jersey else 150

        ax.scatter(elem.x, elem.y, s=size, c=color, marker=marker,
                   edgecolors="white", linewidths=1.5, zorder=5)
        if elem.label:
            ax.annotate(
                elem.label, (elem.x, elem.y),
                textcoords="offset points", xytext=(0, 10),
                ha="center", fontsize=8, color="white",
                fontweight="bold", zorder=6,
            )

    # Draw actions
    for action in drill.actions:
        if action.from_id not in elements_by_id:
            continue
        source = elements_by_id[action.from_id]
        target = _resolve_target(action, elements_by_id)
        if target is None:
            continue

        style = ACTION_STYLES.get(action.type, ACTION_STYLES[ActionType.pass_])
        color = action.color or style["color"]

        if action.type == ActionType.curved_run:
            ax.annotate(
                "", xy=target, xytext=(source.x, source.y),
                arrowprops=dict(
                    arrowstyle="->", color=color, lw=2,
                    connectionstyle="arc3,rad=0.3",
                    linestyle=style["linestyle"],
                ),
                zorder=4,
            )
        else:
            ax.annotate(
                "", xy=target, xytext=(source.x, source.y),
                arrowprops=dict(
                    arrowstyle="->", color=color, lw=2,
                    linestyle=style["linestyle"],
                ),
                zorder=4,
            )

        if action.label:
            mid_x = (source.x + target[0]) / 2
            mid_y = (source.y + target[1]) / 2
            ax.text(mid_x, mid_y, action.label, fontsize=7,
                    ha="center", va="bottom", color=color, zorder=6)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_title = drill.meta.title.replace(" ", "_")[:30]
    filename = f"{safe_title}_{timestamp}.{fmt}"
    filepath = os.path.join(output_dir, filename)

    fig.savefig(filepath, dpi=150, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)

    return filepath
