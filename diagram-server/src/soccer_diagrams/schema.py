"""Pydantic models for drill/session definitions."""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class PitchView(str, Enum):
    full = "full"
    half = "half"
    attacking_third = "attacking_third"


class Team(str, Enum):
    home = "home"
    away = "away"
    neutral = "neutral"


class MarkerType(str, Enum):
    jersey = "jersey"
    cone = "cone"
    ball = "ball"
    dot = "dot"


class ActionType(str, Enum):
    pass_ = "pass"
    run = "run"
    dribble = "dribble"
    shot = "shot"
    curved_run = "curved_run"


class ZoneType(str, Enum):
    rect = "rect"
    circle = "circle"


class Meta(BaseModel):
    title: str
    pitch_view: PitchView = PitchView.full
    pitch_length: float = 105.0
    pitch_width: float = 68.0


class PlayerMarker(BaseModel):
    id: str
    x: float
    y: float
    team: Team = Team.home
    label: Optional[str] = None
    marker: MarkerType = MarkerType.jersey
    color: Optional[str] = None


class Action(BaseModel):
    type: ActionType
    from_id: str
    to_id: Optional[str] = None
    to_x: Optional[float] = None
    to_y: Optional[float] = None
    color: Optional[str] = None
    label: Optional[str] = None


class Zone(BaseModel):
    type: ZoneType
    x: float
    y: float
    width: Optional[float] = None
    height: Optional[float] = None
    radius: Optional[float] = None
    color: Optional[str] = Field(default="#2196F3")
    alpha: float = 0.2
    label: Optional[str] = None


class DrillDefinition(BaseModel):
    meta: Meta
    elements: list[PlayerMarker] = []
    actions: list[Action] = []
    zones: list[Zone] = []
