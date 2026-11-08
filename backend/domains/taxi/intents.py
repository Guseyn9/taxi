"""External Command API intents for Taxi Domain.

Maps README external intentions to ProcessDef + Trigger names. Clients send
these intents; they never choose FSM action names directly.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, FrozenSet, Optional


COMMAND_SCHEMA_VERSION = "1.0"

PASSENGER_ROLES: FrozenSet[str] = frozenset({"client", "passenger", "admin", "system"})
DRIVER_ROLES: FrozenSet[str] = frozenset({"driver", "admin", "system"})
SYSTEM_ROLES: FrozenSet[str] = frozenset({"system", "admin"})


@dataclass(frozen=True)
class TaxiCommandIntent:
    intent: str
    process_name: str
    trigger_name: str
    trigger_type: str = "command"
    allowed_roles: FrozenSet[str] = frozenset()


def _intent(
    name: str,
    *,
    process_name: str,
    allowed_roles: FrozenSet[str],
    trigger_name: Optional[str] = None,
    trigger_type: str = "command",
) -> TaxiCommandIntent:
    return TaxiCommandIntent(
        intent=name,
        process_name=process_name,
        trigger_name=trigger_name or name,
        trigger_type=trigger_type,
        allowed_roles=allowed_roles,
    )


# README «Маппинг команд Taxi Domain»
TAXI_ORDER_INTENTS: Dict[str, TaxiCommandIntent] = {
    "order_registered": _intent("order_registered", process_name="taxi_order_creation", allowed_roles=PASSENGER_ROLES),
    "vote_requested": _intent(
        "vote_requested",
        process_name="taxi_order_creation",
        allowed_roles=PASSENGER_ROLES,
    ),
    "offer_requested": _intent(
        "offer_requested",
        process_name="taxi_order_creation",
        allowed_roles=PASSENGER_ROLES,
    ),
    "direct_assignment_requested": _intent(
        "direct_assignment_requested",
        process_name="taxi_order_creation",
        allowed_roles=PASSENGER_ROLES,
    ),
    "cancel_requested": _intent(
        "cancel_requested",
        process_name="taxi_order_lifecycle",
        allowed_roles=PASSENGER_ROLES,
    ),
    # The assigned driver cancels a taken order; see security.can_execute_taxi_order_command.
    "driver_cancel_requested": _intent(
        "driver_cancel_requested",
        process_name="taxi_order_lifecycle",
        allowed_roles=DRIVER_ROLES,
    ),
    "candidate_selected": _intent(
        "candidate_selected",
        process_name="taxi_order_lifecycle",
        allowed_roles=PASSENGER_ROLES,
    ),
    "candidate_released": _intent(
        "candidate_released",
        process_name="taxi_order_lifecycle",
        allowed_roles=PASSENGER_ROLES,
    ),
    "offer_selected": _intent(
        "offer_selected",
        process_name="taxi_order_lifecycle",
        allowed_roles=PASSENGER_ROLES,
    ),
    "driver_arrived": _intent(
        "driver_arrived",
        process_name="taxi_order_lifecycle",
        allowed_roles=DRIVER_ROLES,
    ),
    "ride_started": _intent(
        "ride_started",
        process_name="taxi_order_lifecycle",
        allowed_roles=DRIVER_ROLES,
    ),
    "ride_finished": _intent(
        "ride_finished",
        process_name="taxi_order_lifecycle",
        allowed_roles=DRIVER_ROLES,
    ),
    "order_expired": _intent(
        "order_expired",
        process_name="taxi_order_lifecycle",
        allowed_roles=SYSTEM_ROLES,
        trigger_type="timer",
    ),
    "pickup_timeout": _intent(
        "pickup_timeout",
        process_name="taxi_order_lifecycle",
        allowed_roles=SYSTEM_ROLES,
        trigger_type="timer",
    ),
    "ride_interrupted": _intent(
        "ride_interrupted",
        process_name="taxi_order_lifecycle",
        allowed_roles=DRIVER_ROLES | PASSENGER_ROLES,
    ),
}

# Optional frontend action aliases → README intents.
# confirm_boarding stays ride_started; boarding is guard/effect before order_start.
FRONTEND_INTENT_ALIASES: Dict[str, str] = {
    "driver.order.arrive": "driver_arrived",
    "driver.order.start": "ride_started",
    "driver.order.confirm_boarding": "ride_started",
    "driver.order.finish": "ride_finished",
    "driver.order.cancel": "driver_cancel_requested",
    "passenger.order.cancel": "cancel_requested",
    "passenger.order.select_candidate": "candidate_selected",
    "passenger.order.release_candidate": "candidate_released",
    "passenger.order.select_offer": "offer_selected",
}


class UnknownTaxiIntentError(ValueError):
    """Raised when the client sends an unsupported command intent."""


def normalize_taxi_intent(intent: str) -> str:
    name = (intent or "").strip()
    if not name:
        raise UnknownTaxiIntentError("intent is required")
    return FRONTEND_INTENT_ALIASES.get(name, name)


def resolve_taxi_order_intent(intent: str) -> TaxiCommandIntent:
    normalized = normalize_taxi_intent(intent)
    try:
        return TAXI_ORDER_INTENTS[normalized]
    except KeyError as exc:
        raise UnknownTaxiIntentError(f"Unsupported taxi intent: {intent}") from exc


class TaxiIntentCatalog:
    """Intent catalog used by the domain-neutral CommandService."""

    service = "taxi"
    entity_type = "order"

    def resolve(self, *, service: str, entity_type: str, intent: str) -> TaxiCommandIntent:
        if service != self.service or entity_type != self.entity_type:
            raise UnknownTaxiIntentError(
                f"Unsupported command target: {service}/{entity_type}"
            )
        return resolve_taxi_order_intent(intent)
