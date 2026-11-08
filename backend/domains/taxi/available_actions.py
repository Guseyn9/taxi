"""AvailableActions resolver for taxi order and driver snapshots."""

from __future__ import annotations

from typing import Dict, List

from .fsm_spec import ORDER_TRANSITIONS, TaxiFsmActions


ACTION_TO_AVAILABLE_ACTION = {
    TaxiFsmActions.ORDER_CANCEL: "cancel",
    TaxiFsmActions.ORDER_SELECT_CANDIDATE: "selectCandidate",
    TaxiFsmActions.ORDER_RELEASE_CANDIDATE: "releaseCandidate",
    TaxiFsmActions.ORDER_SELECT_OFFER: "selectOffer",
    TaxiFsmActions.ORDER_START: "confirmBoarding",
}

DRIVER_ACTION_TO_AVAILABLE_ACTIONS = {
    TaxiFsmActions.ORDER_ARRIVE: ("driver.order.arrive",),
    TaxiFsmActions.ORDER_START: ("driver.order.start", "driver.order.confirm_boarding"),
    TaxiFsmActions.ORDER_FINISH: ("driver.order.finish",),
    TaxiFsmActions.ORDER_CANCEL_BY_DRIVER: ("driver.order.cancel",),
    TaxiFsmActions.ORDER_CANCEL_BY_DRIVER_VOTE: ("driver.order.cancel",),
    TaxiFsmActions.ORDER_CANCEL_BY_DRIVER_OFFER: ("driver.order.cancel",),
}

PASSENGER_ROLES = {"admin", "system", "client", "passenger"}
DRIVER_ROLES = {"admin", "system", "driver"}


def build_available_actions_by_state() -> Dict[str, List[str]]:
    values: Dict[str, List[str]] = {}
    for transition in ORDER_TRANSITIONS:
        available_action = ACTION_TO_AVAILABLE_ACTION.get(transition.action)
        if available_action is None:
            continue
        state_actions = values.setdefault(transition.from_state, [])
        if available_action not in state_actions:
            state_actions.append(available_action)
    return values


def build_driver_available_actions_by_state() -> Dict[str, List[str]]:
    values: Dict[str, List[str]] = {}
    for transition in ORDER_TRANSITIONS:
        available_actions = DRIVER_ACTION_TO_AVAILABLE_ACTIONS.get(transition.action)
        if not available_actions:
            continue
        state_actions = values.setdefault(transition.from_state, [])
        for available_action in available_actions:
            if available_action not in state_actions:
                state_actions.append(available_action)
    return values


AVAILABLE_ACTIONS_BY_STATE = build_available_actions_by_state()
DRIVER_AVAILABLE_ACTIONS_BY_STATE = build_driver_available_actions_by_state()


def resolve_available_actions(state: str, *, user_role: str) -> List[str]:
    if user_role not in PASSENGER_ROLES:
        return []
    return list(AVAILABLE_ACTIONS_BY_STATE.get(state, []))


def resolve_driver_available_actions(state: str, *, user_role: str) -> List[str]:
    if user_role not in DRIVER_ROLES:
        return []
    return list(DRIVER_AVAILABLE_ACTIONS_BY_STATE.get(state, []))
