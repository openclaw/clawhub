"""Model-free startup checks for the worker's actual Pydantic environment."""

from typing import Any, Literal

import pytest
from pydantic import BaseModel, ConfigDict, SerializeAsAny, ValidationError


def test_cold_subclass_serialization_preserves_finding_fields():
    class Finding(BaseModel):
        model_config = ConfigDict(defer_build=True, extra="forbid")
        severity: Literal["HIGH"]
        evidence: str

    class SourceFinding(Finding):
        source: str

    class Report(BaseModel):
        content: SerializeAsAny[Finding]

    finding = SourceFinding.model_construct(
        severity="HIGH", evidence="fixture evidence", source="fixture source"
    )
    report = Report.model_construct(content=finding)
    # Validation or a direct child dump would warm the serializer and hide this bug.
    assert SourceFinding.__pydantic_complete__ is False
    assert report.model_dump(exclude_none=True, mode="json") == {
        "content": {
            "severity": "HIGH",
            "evidence": "fixture evidence",
            "source": "fixture source",
        }
    }
    with pytest.raises(ValidationError):
        Finding.model_validate({"severity": "SAFE", "evidence": "fixture evidence"})


def test_unresolved_deferred_model_still_fails_serialization():
    class Unresolved(BaseModel):
        model_config = ConfigDict(defer_build=True)
        value: "MissingFixtureModel"

    class Report(BaseModel):
        content: Any

    report = Report.model_construct(content=Unresolved.model_construct())
    with pytest.raises(Exception):
        report.model_dump(exclude_none=True, mode="json")
