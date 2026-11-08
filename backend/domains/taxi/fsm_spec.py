"""Taxi FSM state/action names used by repositories and actions.

This is the code-level contract. The database must contain matching rows in
fsm_states, fsm_actions and fsm_transitions before these actions can run.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple


@dataclass(frozen=True)
class TransitionSpec:
    action: str
    from_state: str
    to_state: str
    guard_name: Optional[str] = None
    guard_params: Optional[Dict[str, Any]] = None
    effect_name: Optional[str] = None
    effect_params: Optional[Dict[str, Any]] = None
    timer_name: Optional[str] = None
    timer_params: Optional[Dict[str, Any]] = None


class TaxiFsmActions:
    ORDER_PUBLISH_VOTE = "order_publish_vote"
    ORDER_SELECT_CANDIDATE = "order_select_candidate"
    ORDER_RELEASE_CANDIDATE = "order_release_candidate"
    ORDER_CANCEL = "order_cancel_by_client"
    ORDER_ARRIVE = "order_arrive"
    ORDER_START = "order_start"
    ORDER_FINISH = "order_finish"
    ORDER_ASSIGN_DIRECT = "order_assign_direct"
    ORDER_PUBLISH_OFFER = "order_publish_offer"
    ORDER_SELECT_OFFER = "order_select_offer"
    ORDER_EXPIRE = "order_expire"
    ORDER_INTERRUPT_RIDE = "order_interrupt_ride"
    ORDER_NO_SHOW = "order_no_show"
    ORDER_CANCEL_BY_DRIVER = "order_cancel_by_driver"
    ORDER_CANCEL_BY_DRIVER_VOTE = "order_cancel_by_driver_vote"
    ORDER_CANCEL_BY_DRIVER_OFFER = "order_cancel_by_driver_offer"
    ORDER_CONFIRM_DRIVER_CANCEL = "order_confirm_driver_cancel"
    ORDER_REVERT_DRIVER_CANCEL_TO_VOTE_ASSIGNED = "order_revert_driver_cancel_to_vote_assigned"
    ORDER_REVERT_DRIVER_CANCEL_TO_ASSIGNED = "order_revert_driver_cancel_to_assigned"
    ORDER_REVERT_DRIVER_CANCEL_TO_ARRIVED = "order_revert_driver_cancel_to_arrived"


class TaxiFsmStates:
    ORDER_CREATED = "order_created"
    ORDER_VOTE_WAITING_CANDIDATES = "order_vote_waiting_candidates"
    ORDER_VOTE_DRIVER_ASSIGNED = "order_vote_driver_assigned"
    ORDER_VOTE_NO_SHOW = "order_vote_no_show"
    ORDER_DRIVER_ASSIGNED = "order_driver_assigned"
    ORDER_DRIVER_ARRIVED = "order_driver_arrived"
    ORDER_IN_RIDE = "order_in_ride"
    ORDER_COMPLETED = "order_completed"
    ORDER_CANCELLED = "order_cancelled"
    ORDER_EXPIRED = "order_expired"
    RIDE_INTERRUPTED = "ride_interrupted"
    ORDER_OFFER_WAITING = "order_offer_waiting"
    ORDER_DRIVER_CANCEL_PENDING = "order_driver_cancel_pending"


# The assigned driver cancels a taken order (all modes). The order waits in
# ORDER_DRIVER_CANCEL_PENDING until Core confirms set_cancel_state through the
# outbox, then becomes ORDER_CANCELLED; if Core fails for good, it returns to
# the state it was cancelled from.
DRIVER_CANCELLABLE_STATES: Tuple[str, ...] = (
    TaxiFsmStates.ORDER_VOTE_DRIVER_ASSIGNED,
    TaxiFsmStates.ORDER_DRIVER_ASSIGNED,
    TaxiFsmStates.ORDER_DRIVER_ARRIVED,
)

DRIVER_CANCEL_REVERT_ACTIONS: Dict[str, str] = {
    TaxiFsmStates.ORDER_VOTE_DRIVER_ASSIGNED: TaxiFsmActions.ORDER_REVERT_DRIVER_CANCEL_TO_VOTE_ASSIGNED,
    TaxiFsmStates.ORDER_DRIVER_ASSIGNED: TaxiFsmActions.ORDER_REVERT_DRIVER_CANCEL_TO_ASSIGNED,
    TaxiFsmStates.ORDER_DRIVER_ARRIVED: TaxiFsmActions.ORDER_REVERT_DRIVER_CANCEL_TO_ARRIVED,
}


# T5/T8 are context updates, not FSM transitions:
# CandidateAdded and OfferAdded update orders.metadata_json without changing state.
#
# T15 expires only before assignment. After assignment the order is handled by
# no-show/cancel/re-match rules, not by order_expire.
#
# T16 no-show is VOTE-only. DIRECT/OFFER pickup problems resolve to
# order_cancelled for MVP; do not add per-mode no-show terminal states.
ORDER_TRANSITIONS: Tuple[TransitionSpec, ...] = (
    TransitionSpec(
        TaxiFsmActions.ORDER_PUBLISH_VOTE,
        TaxiFsmStates.ORDER_CREATED,
        TaxiFsmStates.ORDER_VOTE_WAITING_CANDIDATES,
    ),
    TransitionSpec(
        TaxiFsmActions.ORDER_SELECT_CANDIDATE,
        TaxiFsmStates.ORDER_VOTE_WAITING_CANDIDATES,
        TaxiFsmStates.ORDER_VOTE_DRIVER_ASSIGNED,
        guard_name="can_select_candidate",
        effect_name="create_trip",
    ),
    TransitionSpec(
        TaxiFsmActions.ORDER_RELEASE_CANDIDATE,
        TaxiFsmStates.ORDER_VOTE_DRIVER_ASSIGNED,
        TaxiFsmStates.ORDER_VOTE_WAITING_CANDIDATES,
    ),
    TransitionSpec(
        TaxiFsmActions.ORDER_NO_SHOW,
        TaxiFsmStates.ORDER_VOTE_DRIVER_ASSIGNED,
        TaxiFsmStates.ORDER_VOTE_NO_SHOW,
    ),
    TransitionSpec(
        TaxiFsmActions.ORDER_ASSIGN_DIRECT,
        TaxiFsmStates.ORDER_CREATED,
        TaxiFsmStates.ORDER_DRIVER_ASSIGNED,
        effect_name="create_trip",
    ),
    TransitionSpec(
        TaxiFsmActions.ORDER_PUBLISH_OFFER,
        TaxiFsmStates.ORDER_CREATED,
        TaxiFsmStates.ORDER_OFFER_WAITING,
    ),
    TransitionSpec(
        TaxiFsmActions.ORDER_SELECT_OFFER,
        TaxiFsmStates.ORDER_OFFER_WAITING,
        TaxiFsmStates.ORDER_DRIVER_ASSIGNED,
        effect_name="create_trip",
    ),
    TransitionSpec(
        TaxiFsmActions.ORDER_ARRIVE,
        TaxiFsmStates.ORDER_VOTE_DRIVER_ASSIGNED,
        TaxiFsmStates.ORDER_DRIVER_ARRIVED,
    ),
    TransitionSpec(
        TaxiFsmActions.ORDER_ARRIVE,
        TaxiFsmStates.ORDER_DRIVER_ASSIGNED,
        TaxiFsmStates.ORDER_DRIVER_ARRIVED,
    ),
    TransitionSpec(
        TaxiFsmActions.ORDER_START,
        TaxiFsmStates.ORDER_DRIVER_ARRIVED,
        TaxiFsmStates.ORDER_IN_RIDE,
        guard_name="can_start_ride",
        effect_name="mark_trip_started",
    ),
    TransitionSpec(
        TaxiFsmActions.ORDER_FINISH,
        TaxiFsmStates.ORDER_IN_RIDE,
        TaxiFsmStates.ORDER_COMPLETED,
        effect_name="mark_trip_finished",
    ),
    TransitionSpec(
        TaxiFsmActions.ORDER_CANCEL,
        TaxiFsmStates.ORDER_CREATED,
        TaxiFsmStates.ORDER_CANCELLED,
        guard_name="can_cancel_order",
    ),
    TransitionSpec(
        TaxiFsmActions.ORDER_CANCEL,
        TaxiFsmStates.ORDER_VOTE_WAITING_CANDIDATES,
        TaxiFsmStates.ORDER_CANCELLED,
        guard_name="can_cancel_order",
    ),
    TransitionSpec(
        TaxiFsmActions.ORDER_CANCEL,
        TaxiFsmStates.ORDER_VOTE_DRIVER_ASSIGNED,
        TaxiFsmStates.ORDER_CANCELLED,
        guard_name="can_cancel_order",
    ),
    TransitionSpec(
        TaxiFsmActions.ORDER_CANCEL,
        TaxiFsmStates.ORDER_DRIVER_ASSIGNED,
        TaxiFsmStates.ORDER_CANCELLED,
        guard_name="can_cancel_order",
    ),
    TransitionSpec(
        TaxiFsmActions.ORDER_CANCEL,
        TaxiFsmStates.ORDER_DRIVER_ARRIVED,
        TaxiFsmStates.ORDER_CANCELLED,
        guard_name="can_cancel_order",
    ),
    TransitionSpec(
        TaxiFsmActions.ORDER_CANCEL,
        TaxiFsmStates.ORDER_OFFER_WAITING,
        TaxiFsmStates.ORDER_CANCELLED,
        guard_name="can_cancel_order",
    ),
    TransitionSpec(
        TaxiFsmActions.ORDER_EXPIRE,
        TaxiFsmStates.ORDER_CREATED,
        TaxiFsmStates.ORDER_EXPIRED,
    ),
    TransitionSpec(
        TaxiFsmActions.ORDER_EXPIRE,
        TaxiFsmStates.ORDER_VOTE_WAITING_CANDIDATES,
        TaxiFsmStates.ORDER_EXPIRED,
    ),
    TransitionSpec(
        TaxiFsmActions.ORDER_EXPIRE,
        TaxiFsmStates.ORDER_OFFER_WAITING,
        TaxiFsmStates.ORDER_EXPIRED,
    ),
    TransitionSpec(
        TaxiFsmActions.ORDER_INTERRUPT_RIDE,
        TaxiFsmStates.ORDER_IN_RIDE,
        TaxiFsmStates.RIDE_INTERRUPTED,
    ),
    *(TransitionSpec(action, state, target, guard_name="can_driver_cancel_order")
      for action, states, target in (
        (TaxiFsmActions.ORDER_CANCEL_BY_DRIVER, (TaxiFsmStates.ORDER_DRIVER_ASSIGNED, TaxiFsmStates.ORDER_DRIVER_ARRIVED), TaxiFsmStates.ORDER_CREATED),
        (TaxiFsmActions.ORDER_CANCEL_BY_DRIVER_VOTE, (TaxiFsmStates.ORDER_VOTE_DRIVER_ASSIGNED, TaxiFsmStates.ORDER_DRIVER_ARRIVED), TaxiFsmStates.ORDER_VOTE_WAITING_CANDIDATES),
        (TaxiFsmActions.ORDER_CANCEL_BY_DRIVER_OFFER, (TaxiFsmStates.ORDER_DRIVER_ASSIGNED, TaxiFsmStates.ORDER_DRIVER_ARRIVED), TaxiFsmStates.ORDER_OFFER_WAITING),
      ) for state in states),
    TransitionSpec("order_register", TaxiFsmStates.ORDER_CREATED, TaxiFsmStates.ORDER_CREATED),
    TransitionSpec("order_register_offer", TaxiFsmStates.ORDER_CREATED, TaxiFsmStates.ORDER_OFFER_WAITING),
)
