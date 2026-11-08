"""Courier guard extension point.

The current delivery engine already checks transitions through MySQL
fsm_perform_action. Domain-specific guards can be added here without changing
the SQL core. Stage 1 deliberately registers no catch-all guard: a guard must
name a concrete business rule before it is attached to a transition.
"""

from __future__ import annotations
