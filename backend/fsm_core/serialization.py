"""Shared JSON serialization helpers used by platform and domain adapters."""

from __future__ import annotations

import json
from typing import Any, Dict, Mapping


def json_loads_object(value: Any) -> Dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str):
        decoded = json.loads(value) if value else {}
        if not isinstance(decoded, dict):
            raise ValueError("Expected a JSON object")
        return decoded
    if isinstance(value, Mapping):
        return dict(value)
    return dict(value)


def json_dumps(value: Any) -> str:
    return json.dumps(value if value is not None else {}, ensure_ascii=False)


def json_loads(value: Any) -> Any:
    if value is None or value == "":
        return {}
    if isinstance(value, str):
        return json.loads(value)
    return value
