"""Courier effect extension point.

Effects are intentionally minimal in stage 1. Existing side effects remain in
the current stored procedure/triggers and old service layer until they are
explicitly moved into FSM Platform runtime. Transitions without an effect keep
``effect_name = NULL``; no synthetic no-op effect is registered.
"""

from __future__ import annotations
