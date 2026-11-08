"""Taxi domain actions.

Actions orchestrate core adapter calls, repository writes and FSM transitions.
They never create/commit/rollback/close SQLAlchemy sessions; the worker owns the
session lifecycle.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from .core_adapter import CoreActionResult, CoreAdapter, MissingCoreOrderError
from .fsm_spec import TaxiFsmActions, TaxiFsmStates
from .models import Candidate, Incident, Offer, OrderMode, OrderStatus
from .repositories import (
    CoreOrderMappingRepository,
    FsmInstanceRepository,
    FsmTransitionRepository,
    IncidentRepository,
    OrderRepository,
)


@dataclass(frozen=True)
class TaxiActionResult:
    local_order_id: int
    core_order_id: Optional[int] = None
    fsm_message: Optional[str] = None
    core_payload: Dict[str, Any] = field(default_factory=dict)


class TaxiOrderActions:
    def __init__(self, session: Session, core_adapter: CoreAdapter):
        self.session = session
        self.core = core_adapter
        self.orders = OrderRepository(session)
        self.mappings = CoreOrderMappingRepository(session)
        self.instances = FsmInstanceRepository(session)
        self.incidents = IncidentRepository(session)
        self.fsm = FsmTransitionRepository(session)

    def order_create(
        self,
        *,
        payload: Dict[str, Any],
        client_user_id: int,
        mode: OrderMode = OrderMode.VOTE,
        description: Optional[str] = None,
    ) -> TaxiActionResult:
        core_result = self.core.create_order(payload)
        metadata = {
            "mode": mode.value,
            "core_payload": payload,
            "candidates": [],
            "offers": [],
            "selected_candidate": None,
            "selected_offer": None,
        }
        local_order_id = self.orders.create(
            mode=mode,
            description=description or payload.get("b_custom_comment"),
            metadata_json=metadata,
            status=OrderStatus.CREATED.value,
        )
        self.mappings.upsert(
            local_order_id=local_order_id,
            core_order_id=core_result.core_order_id,
            role="client",
            kind=payload.get("kind", 1),
            upper=payload.get("upper"),
            b_state=core_result.b_state,
            client_local_user_id=client_user_id,
        )
        self.instances.create(
            service="taxi",
            entity_type="order",
            entity_id=local_order_id,
            process_name="taxi_order_creation",
            fsm_state=OrderStatus.CREATED.value,
            instance_status="PENDING",
            trigger_type="command",
            trigger_name="order_created",
            trigger_payload={"mode": mode.value},
            requested_by_user_id=client_user_id,
            requested_user_role="client",
            metadata_json={"mode": mode.value},
        )
        return TaxiActionResult(
            local_order_id=local_order_id,
            core_order_id=core_result.core_order_id,
            core_payload=core_result.payload,
        )

    def order_publish_vote(
        self,
        *,
        local_order_id: int,
        client_user_id: int,
        b_estimate_waiting: Optional[int] = None,
    ) -> TaxiActionResult:
        mapping = self._require_mapping(local_order_id)
        core_result = self.core.set_confirm_state(
            mapping.core_order_id,
            b_estimate_waiting=b_estimate_waiting,
        )
        self._require_core_ok("set_confirm_state", core_result)
        fsm_result = self.fsm.transition(
            "order",
            local_order_id,
            TaxiFsmActions.ORDER_PUBLISH_VOTE,
            client_user_id,
        )
        self._after_transition(local_order_id, TaxiFsmStates.ORDER_VOTE_WAITING_CANDIDATES, core_result)
        return TaxiActionResult(
            local_order_id=local_order_id,
            core_order_id=mapping.core_order_id,
            fsm_message=fsm_result.message,
            core_payload=core_result.payload,
        )

    def order_select_candidate(
        self,
        *,
        local_order_id: int,
        client_user_id: int,
        driver_user_id: int,
        t_id: Optional[str] = None,
    ) -> TaxiActionResult:
        mapping = self._require_mapping(local_order_id)
        core_result = self.core.set_performer(
            mapping.core_order_id,
            user_id=driver_user_id,
            performer="1",
            t_id=t_id,
        )
        self._require_core_ok("set_performer", core_result)
        self.orders.select_candidate(local_order_id, driver_user_id)
        self.mappings.update_performer(local_order_id, driver_user_id)
        fsm_result = self.fsm.transition(
            "order",
            local_order_id,
            TaxiFsmActions.ORDER_SELECT_CANDIDATE,
            client_user_id,
            str(driver_user_id),
        )
        self._after_transition(local_order_id, TaxiFsmStates.ORDER_VOTE_DRIVER_ASSIGNED, core_result)
        return TaxiActionResult(
            local_order_id=local_order_id,
            core_order_id=mapping.core_order_id,
            fsm_message=fsm_result.message,
            core_payload=core_result.payload,
        )

    def order_release_candidate(
        self,
        *,
        local_order_id: int,
        client_user_id: int,
        driver_user_id: int,
    ) -> TaxiActionResult:
        mapping = self._require_mapping(local_order_id)
        core_result = self.core.set_performer(
            mapping.core_order_id,
            user_id=driver_user_id,
            performer="0",
        )
        self._require_core_ok("set_performer", core_result)
        self.orders.release_candidate(local_order_id)
        self.mappings.update_performer(local_order_id, None)
        fsm_result = self.fsm.transition(
            "order",
            local_order_id,
            TaxiFsmActions.ORDER_RELEASE_CANDIDATE,
            client_user_id,
            str(driver_user_id),
        )
        self._after_transition(local_order_id, TaxiFsmStates.ORDER_VOTE_WAITING_CANDIDATES, core_result)
        return TaxiActionResult(
            local_order_id=local_order_id,
            core_order_id=mapping.core_order_id,
            fsm_message=fsm_result.message,
            core_payload=core_result.payload,
        )

    def order_assign_direct(
        self,
        *,
        local_order_id: int,
        actor_user_id: int,
        driver_user_id: int,
        t_id: Optional[str] = None,
    ) -> TaxiActionResult:
        mapping = self._require_mapping(local_order_id)
        core_result = self.core.set_performer(
            mapping.core_order_id,
            user_id=driver_user_id,
            performer="1",
            t_id=t_id,
        )
        self._require_core_ok("set_performer", core_result)
        self.orders.select_candidate(local_order_id, driver_user_id)
        self.mappings.update_performer(local_order_id, driver_user_id)
        fsm_result = self.fsm.transition(
            "order",
            local_order_id,
            TaxiFsmActions.ORDER_ASSIGN_DIRECT,
            actor_user_id,
            str(driver_user_id),
        )
        self._after_transition(local_order_id, TaxiFsmStates.ORDER_DRIVER_ASSIGNED, core_result)
        return TaxiActionResult(
            local_order_id=local_order_id,
            core_order_id=mapping.core_order_id,
            fsm_message=fsm_result.message,
            core_payload=core_result.payload,
        )

    def order_publish_offer(self, *, local_order_id: int, client_user_id: int) -> TaxiActionResult:
        mapping = self._require_mapping(local_order_id)
        fsm_result = self.fsm.transition(
            "order",
            local_order_id,
            TaxiFsmActions.ORDER_PUBLISH_OFFER,
            client_user_id,
        )
        core_result = CoreActionResult(ok=True)
        self._after_transition(local_order_id, TaxiFsmStates.ORDER_OFFER_WAITING, core_result)
        return TaxiActionResult(
            local_order_id=local_order_id,
            core_order_id=mapping.core_order_id,
            fsm_message=fsm_result.message,
        )

    def driver_set_offer(
        self,
        *,
        local_order_id: int,
        driver_user_id: int,
        offer: Optional[Offer] = None,
        t_id: Optional[str] = None,
    ) -> TaxiActionResult:
        mapping = self._require_mapping(local_order_id)
        core_result = self.core.set_offer(
            mapping.core_order_id,
            user_id=driver_user_id,
            t_id=t_id,
        )
        self._require_core_ok("set_offer", core_result)
        self.orders.upsert_offer(
            local_order_id,
            offer or Offer(user_id=driver_user_id, trip_ids=t_id),
        )
        return TaxiActionResult(
            local_order_id=local_order_id,
            core_order_id=mapping.core_order_id,
            core_payload=core_result.payload,
        )

    def order_select_offer(
        self,
        *,
        local_order_id: int,
        client_user_id: int,
        driver_user_id: int,
        t_id: Optional[str] = None,
    ) -> TaxiActionResult:
        mapping = self._require_mapping(local_order_id)
        core_result = self.core.set_performer(
            mapping.core_order_id,
            user_id=driver_user_id,
            performer="1",
            t_id=t_id,
        )
        self._require_core_ok("set_performer", core_result)
        self.orders.select_offer(local_order_id, driver_user_id)
        self.mappings.update_performer(local_order_id, driver_user_id)
        fsm_result = self.fsm.transition(
            "order",
            local_order_id,
            TaxiFsmActions.ORDER_SELECT_OFFER,
            client_user_id,
            str(driver_user_id),
        )
        self._after_transition(local_order_id, TaxiFsmStates.ORDER_DRIVER_ASSIGNED, core_result)
        return TaxiActionResult(
            local_order_id=local_order_id,
            core_order_id=mapping.core_order_id,
            fsm_message=fsm_result.message,
            core_payload=core_result.payload,
        )

    def order_cancel(
        self,
        *,
        local_order_id: int,
        actor_user_id: int,
        reason: Optional[str] = None,
        cancel_states: Optional[str] = None,
        forced: Optional[bool] = None,
    ) -> TaxiActionResult:
        mapping = self._require_mapping(local_order_id)
        core_result = self.core.set_cancel_state(
            mapping.core_order_id,
            reason=reason,
            cancel_states=cancel_states,
            forced=forced,
        )
        self._require_core_ok("set_cancel_state", core_result)
        self.orders.patch_metadata(local_order_id, {"cancel_reason": reason})
        fsm_result = self.fsm.transition(
            "order",
            local_order_id,
            TaxiFsmActions.ORDER_CANCEL,
            actor_user_id,
            reason,
        )
        self._after_transition(local_order_id, TaxiFsmStates.ORDER_CANCELLED, core_result)
        return TaxiActionResult(
            local_order_id=local_order_id,
            core_order_id=mapping.core_order_id,
            fsm_message=fsm_result.message,
            core_payload=core_result.payload,
        )

    def order_arrive(self, *, local_order_id: int, driver_user_id: int) -> TaxiActionResult:
        mapping = self._require_mapping(local_order_id)
        core_result = self.core.set_arrive_state(mapping.core_order_id)
        self._require_core_ok("set_arrive_state", core_result)
        fsm_result = self.fsm.transition(
            "order",
            local_order_id,
            TaxiFsmActions.ORDER_ARRIVE,
            driver_user_id,
        )
        self._after_transition(local_order_id, TaxiFsmStates.ORDER_DRIVER_ARRIVED, core_result)
        return TaxiActionResult(local_order_id, mapping.core_order_id, fsm_result.message, core_result.payload)

    def order_start(self, *, local_order_id: int, driver_user_id: int) -> TaxiActionResult:
        mapping = self._require_mapping(local_order_id)
        core_result = self.core.set_start_state(mapping.core_order_id)
        self._require_core_ok("set_start_state", core_result)
        fsm_result = self.fsm.transition(
            "order",
            local_order_id,
            TaxiFsmActions.ORDER_START,
            driver_user_id,
        )
        self._after_transition(local_order_id, TaxiFsmStates.ORDER_IN_RIDE, core_result)
        return TaxiActionResult(local_order_id, mapping.core_order_id, fsm_result.message, core_result.payload)

    def order_finish(self, *, local_order_id: int, actor_user_id: int) -> TaxiActionResult:
        mapping = self._require_mapping(local_order_id)
        core_result = self.core.set_complete_state(mapping.core_order_id)
        self._require_core_ok("set_complete_state", core_result)
        fsm_result = self.fsm.transition(
            "order",
            local_order_id,
            TaxiFsmActions.ORDER_FINISH,
            actor_user_id,
        )
        self._after_transition(local_order_id, TaxiFsmStates.ORDER_COMPLETED, core_result)
        return TaxiActionResult(local_order_id, mapping.core_order_id, fsm_result.message, core_result.payload)

    def order_no_show(
        self,
        *,
        local_order_id: int,
        actor_user_id: int,
        description: Optional[str] = None,
    ) -> TaxiActionResult:
        mapping = self._require_mapping(local_order_id)
        self.incidents.create_for_order(
            Incident(
                order_id=local_order_id,
                incident_type="no_show",
                description=description,
                user_id=actor_user_id,
            )
        )
        fsm_result = self.fsm.transition(
            "order",
            local_order_id,
            TaxiFsmActions.ORDER_NO_SHOW,
            actor_user_id,
        )
        core_result = CoreActionResult(ok=True)
        self._after_transition(local_order_id, TaxiFsmStates.ORDER_VOTE_NO_SHOW, core_result)
        return TaxiActionResult(
            local_order_id=local_order_id,
            core_order_id=mapping.core_order_id,
            fsm_message=fsm_result.message,
        )

    def order_expire(self, *, local_order_id: int, actor_user_id: int) -> TaxiActionResult:
        mapping = self._require_mapping(local_order_id)
        fsm_result = self.fsm.transition(
            "order",
            local_order_id,
            TaxiFsmActions.ORDER_EXPIRE,
            actor_user_id,
        )
        core_result = CoreActionResult(ok=True)
        self._after_transition(local_order_id, TaxiFsmStates.ORDER_EXPIRED, core_result)
        return TaxiActionResult(
            local_order_id=local_order_id,
            core_order_id=mapping.core_order_id,
            fsm_message=fsm_result.message,
        )

    def order_interrupt_ride(
        self,
        *,
        local_order_id: int,
        actor_user_id: int,
        reason: Optional[str] = None,
    ) -> TaxiActionResult:
        mapping = self._require_mapping(local_order_id)
        self.incidents.create_for_order(
            Incident(
                order_id=local_order_id,
                incident_type="ride_interrupted",
                description=reason,
                user_id=actor_user_id,
            )
        )
        fsm_result = self.fsm.transition(
            "order",
            local_order_id,
            TaxiFsmActions.ORDER_INTERRUPT_RIDE,
            actor_user_id,
            reason,
        )
        core_result = CoreActionResult(ok=True)
        self._after_transition(local_order_id, TaxiFsmStates.RIDE_INTERRUPTED, core_result)
        return TaxiActionResult(
            local_order_id=local_order_id,
            core_order_id=mapping.core_order_id,
            fsm_message=fsm_result.message,
        )

    def add_candidate_metadata(self, *, local_order_id: int, candidate: Candidate) -> None:
        self.orders.upsert_candidate(local_order_id, candidate)

    def add_offer_metadata(self, *, local_order_id: int, offer: Offer) -> None:
        self.orders.upsert_offer(local_order_id, offer)

    def create_incident(self, incident: Incident) -> None:
        self.incidents.create_for_order(incident)

    def _require_mapping(self, local_order_id: int):
        mapping = self.mappings.get_by_local_order_id(local_order_id)
        if mapping is None or mapping.core_order_id is None:
            raise MissingCoreOrderError(f"Order #{local_order_id} has no core mapping")
        return mapping

    def _require_core_ok(self, action_name: str, result: CoreActionResult) -> None:
        if not result.ok:
            raise RuntimeError(f"Core action {action_name} failed")

    def _after_transition(
        self,
        local_order_id: int,
        fsm_state: str,
        core_result: CoreActionResult,
    ) -> None:
        self.instances.set_state("order", local_order_id, fsm_state)
        if core_result.b_state is not None:
            self.mappings.update_b_state(local_order_id, core_result.b_state)
