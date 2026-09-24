"""Workspace-owned prompt optimization choices; no credentials or connections."""
from __future__ import annotations
import json
import os
import uuid
from pathlib import Path
from typing import Literal, Optional
from pydantic import BaseModel, ConfigDict, Field, model_validator

class OptimizationInstructions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    smart: str = Field(default="", max_length=6000)
    preserve: str = Field(default="", max_length=6000)
    visual: str = Field(default="", max_length=6000)

class VideoOptimizationInstructions(OptimizationInstructions):
    camera: str = Field(default="", max_length=6000)

class ImageOptimizationProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    default_preset: Literal["smart", "preserve", "visual"] = "smart"
    provider: str = Field(default="", max_length=200)
    model: str = Field(default="", max_length=300)
    instructions: OptimizationInstructions = Field(default_factory=OptimizationInstructions)

class VideoOptimizationProfile(ImageOptimizationProfile):
    default_preset: Literal["smart", "preserve", "visual", "camera"] = "smart"
    instructions: VideoOptimizationInstructions = Field(default_factory=VideoOptimizationInstructions)

class RepairPresets(BaseModel):
    model_config = ConfigDict(extra="forbid")
    hand: Optional[str] = Field(default=None, max_length=6000)
    fingers: Optional[str] = Field(default=None, max_length=6000)
    limbs: Optional[str] = Field(default=None, max_length=6000)
    smearing: Optional[str] = Field(default=None, max_length=6000)
    fabric: Optional[str] = Field(default=None, max_length=6000)
    noise: Optional[str] = Field(default=None, max_length=6000)
    suffix: Optional[str] = Field(default=None, max_length=6000)

class PromptOptimizationSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[2] = 2
    image: ImageOptimizationProfile = Field(default_factory=ImageOptimizationProfile)
    video: VideoOptimizationProfile = Field(default_factory=VideoOptimizationProfile)
    repair: RepairPresets = Field(default_factory=RepairPresets)

    @model_validator(mode="before")
    @classmethod
    def migrate_shared_settings(cls, value):
        # Validate the old schema before copying it; do not hide corruption.
        if isinstance(value, dict) and value.get("version") == 1:
            class LegacySettings(VideoOptimizationProfile):
                version: Literal[1] = 1
            shared = LegacySettings.model_validate(value).model_dump(exclude={"version"})
            image = {**shared, "instructions": {key: rule for key, rule in shared["instructions"].items() if key != "camera"}}
            return {"version": 2, "image": image, "video": shared}
        return value

def load_settings(path: Path) -> PromptOptimizationSettings:
    try:
        content = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return PromptOptimizationSettings()
    return PromptOptimizationSettings.model_validate_json(content)

def save_settings(path: Path, settings: PromptOptimizationSettings) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(json.dumps(settings.model_dump(),ensure_ascii=False,indent=2),encoding="utf-8")
        os.replace(temporary,path)
    finally:
        temporary.unlink(missing_ok=True)
