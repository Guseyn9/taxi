"""Taxi-specific Core request builders and confirmed local projections."""
from sqlalchemy import text
from fsm_core.core_client import CoreRefused, CoreUnavailable
from fsm_core.outbox import DeliveryResult, PermanentDeliveryError
from fsm_core.errors import AuthenticationError, AuthenticationUnavailable
from fsm_core.serialization import json_dumps
from .repositories import OrderRepository


ACTION_TO_CORE = {
    "order_register": None,
    "order_register_offer": None,
    "order_publish_vote": "set_confirm_state",
    # OFFER is published by POST /drive with its price. Confirm by reading it.
    "order_publish_offer": None,
    "order_assign_direct": "set_performer",
    "order_select_candidate": "set_performer",
    "order_release_candidate": "set_performer",
    "order_select_offer": "set_performer",
    "order_arrive": "set_arrive_state", "order_start": "set_start_state",
    "order_finish": "set_complete_state",
    "order_cancel_by_client": "set_cancel_state", "order_cancel_by_driver": "set_cancel_state",
    "order_cancel_by_driver_vote": "set_cancel_state", "order_cancel_by_driver_offer": "set_cancel_state",
    "order_expire": "set_cancel_state", "order_no_show": "set_cancel_state",
    "order_interrupt_ride": "set_cancel_state",
}
SELECTIONS = {"candidate_selected": "candidates", "offer_selected": "offers", "direct_assignment_requested": "candidates"}


def selected_driver(context, intent, payload):
    raw = payload.get("driverUserId", payload.get("userId", payload.get("u_id")))
    try:
        uid = int(raw)
    except (ValueError, TypeError):
        raise ValueError("A valid driverUserId is required") from None
    entries = context.metadata_json.get(SELECTIONS[intent], [])
    match = next((item for item in entries if isinstance(item, dict) and str(item.get("user_id")) == str(uid)), None)
    if not match:
        raise ValueError("Selected driver is not a current candidate or offer author")
    return match


def validate_command_payload(context, intent, payload):
    if intent in SELECTIONS:
        selected_driver(context, intent, payload)
    if intent == "ride_started" and context.mode.value == "VOTE":
        code = payload.get("boardingCode", payload.get("pin"))
        if not isinstance(code, (str, int)) or not str(code).isdigit() or len(str(code)) > 12:
            raise ValueError("A boarding code is required for a voting ride")


def build_core_request(session, context, trigger, action, user_id):
    validate_command_payload(context, trigger.trigger_name, trigger.payload)
    if action in {"order_register", "order_register_offer"}:
        return {"path": "/drive", "fields": {"data": json_dumps(context.metadata_json["create_data"])}, "create": True, "userId": user_id}
    if context.core_order_id is None:
        raise ValueError("Order has no confirmed Core mapping")
    core_action = ACTION_TO_CORE[action]
    fields = {"action": core_action} if core_action else {}
    if action in {"order_select_candidate", "order_select_offer", "order_assign_direct"}:
        selected = selected_driver(context, trigger.trigger_name, trigger.payload)
        fields.update(u_id=int(selected["user_id"]), performer=1)
    if action == "order_release_candidate":
        selected = context.metadata_json.get("selected_candidate")
        if not isinstance(selected, dict):
            raise ValueError("Order has no selected candidate")
        fields.update(u_id=int(selected["user_id"]), performer=0)
    if core_action == "set_cancel_state":
        fields["reason"] = str(trigger.payload.get("reason", ""))[:500]
    request = {"path": f"/drive/get/{context.core_order_id}", "fields": fields, "userId": user_id}
    if action.startswith("order_cancel_by_driver"):
        request["driverCancel"] = True
    if action == "order_start" and context.mode.value == "VOTE":
        request["requiresBoardingCode"] = True
    if not core_action:
        request["readOnly"] = True
    return request


def extract_booking(result, core_id=None):
    data = result.get("data", {})
    booking = data.get("booking", []) if isinstance(data, dict) else []
    if isinstance(booking, dict):
        booking = list(booking.values())
    if not isinstance(booking, list):
        return None
    return next((item for item in booking if isinstance(item, dict) and (core_id is None or str(item.get("b_id")) == str(core_id))), None)


def operation_confirmed(request, booking):
    if booking is None:
        return False
    fields = request.get("fields", {})
    action = fields.get("action")
    state = str(booking.get("b_state"))
    drivers = booking.get("drivers", [])
    if isinstance(drivers, dict):
        drivers = list(drivers.values())
    uid = fields.get("u_id", request["userId"])
    driver = next((item for item in drivers if str(item.get("u_id")) == str(uid)), {})
    driver_state = str(driver.get("c_state"))
    if request.get("readOnly"):
        return state in {"1", "6"}
    if action == "set_cancel_state":
        return driver_state == "2" and state in {"1","2","5","6"} if request.get("driverCancel") else state == "3"
    if action == "set_complete_state":
        return state == "4" and driver_state == "6"
    if action == "set_performer":
        return driver_state == ("3" if fields["performer"] else "1")
    if action == "set_arrive_state":
        return driver_state == "4"
    if action == "set_start_state":
        return driver_state == "5"
    if action == "set_confirm_state":
        return str(booking.get("b_confirm_state")) == "1"
    return False


class IbronevikOutboxHandler:
    def __init__(self, client, cipher):
        self.client, self.cipher = client, cipher

    def __call__(self, event):
        try:
            credentials, private_payload = self.cipher.decrypt_bundle(event.credentials_encrypted)
            try:
                uid, _ = self.client.authorize(credentials)
            except AuthenticationError:
                # A permission rejection or expired encrypted stash is not
                # evidence that the user's current Core login was revoked.
                reason = 'CORE_OUTCOME_UNKNOWN' if event.write_attempted is True else 'CORE_AUTHENTICATION_REQUIRED'
                raise PermanentDeliveryError(reason) from None
            if uid != event.payload["userId"]:
                raise PermanentDeliveryError("AUTHORIZATION_FAILED")
            request = event.payload
            core_id = request["path"].rsplit("/", 1)[-1]
            # After a timeout/crash a write may have reached Core. Never replay
            # legacy writes without Core-side idempotency. Read first; if proof
            # is unavailable, quarantine for operator reconciliation.
            if not request.get("readOnly") and (event.write_attempted is True or event.write_attempted is None and event.attempts > 1):
                if request.get("create"):
                    raise PermanentDeliveryError("CORE_OUTCOME_UNKNOWN")
                result = self.client.post(request["path"], credentials, {"fields": "00000000u1"})
                booking = extract_booking(result, core_id)
                if not operation_confirmed(request, booking):
                    raise PermanentDeliveryError("CORE_OUTCOME_UNKNOWN")
                return DeliveryResult(response=projection(booking))
            fields = dict(request["fields"])
            if request.get("requiresBoardingCode"):
                code = private_payload.get("boardingCode",private_payload.get("pin"))
                if code is None:
                    raise PermanentDeliveryError("CORE_REJECTED")
                self.client.post(request["path"], credentials, {"action": "check_driver_code", "b_driver_code": code})
                fields["b_driver_code"] = code
            if not request.get("readOnly") and event.before_write:
                event.before_write()
            result = self.client.post(request["path"], credentials, fields)
            booking = extract_booking(result, core_id)
            if request.get("driverCancel"):
                confirmed = self.client.post(request["path"], credentials, {"fields":"00000000u1"})
                booking = extract_booking(confirmed, core_id)
                if not operation_confirmed(request, booking):
                    raise PermanentDeliveryError("CORE_OUTCOME_UNKNOWN")
            if request.get("readOnly") and not operation_confirmed(request, booking):
                raise PermanentDeliveryError("CORE_REJECTED")
            if request.get("create"):
                # Current PHP create response: data.b_id (not a booking array).
                data = result.get("data", {})
                created_id = data.get("b_id") if isinstance(data, dict) else None
                if not created_id or not str(created_id).isdigit():
                    raise PermanentDeliveryError("CORE_OUTCOME_UNKNOWN")
                return DeliveryResult(response={"coreOrderId": int(created_id)})
            return DeliveryResult(response=projection(booking))
        except (AuthenticationError, CoreRefused) as exc:
            if event.write_attempted is True:
                raise PermanentDeliveryError("CORE_OUTCOME_UNKNOWN") from None
            raise PermanentDeliveryError(getattr(exc, "code", "AUTHORIZATION_FAILED")) from None
        except (CoreUnavailable, AuthenticationUnavailable):
            raise RuntimeError("CORE_TEMPORARILY_UNAVAILABLE") from None


def projection(booking):
    # Whitelist: never persist an auth_user, token, raw body or arbitrary error.
    if booking is None:
        return {}
    return {"bState": booking.get("b_state")}


def apply_core_confirmation(session, context, trigger, action, response):
    patch = {}
    if trigger.trigger_name in SELECTIONS:
        selected = selected_driver(context, trigger.trigger_name, trigger.payload)
        key = "selected_offer" if trigger.trigger_name == "offer_selected" else "selected_candidate"
        patch = {key: selected, "driver_user_id": int(selected["user_id"])}
        session.execute(text("UPDATE core_order_mapping SET performer_local_user_id=:uid WHERE local_order_id=:id"), {"uid": int(selected["user_id"]), "id": context.id})
    elif action == "order_release_candidate":
        patch = {"selected_candidate": None, "driver_user_id": None}
        session.execute(text("UPDATE core_order_mapping SET performer_local_user_id=NULL WHERE local_order_id=:id"), {"id": context.id})
    elif action.startswith("order_cancel_by_driver"):
        # This is a driver participation cancellation, not passenger cancellation.
        previous = context.metadata_json.get("driver_user_id")
        if previous is None:
            previous = session.execute(text("SELECT performer_local_user_id FROM core_order_mapping WHERE local_order_id=:id"), {"id":context.id}).scalar()
        cancelled = list(context.metadata_json.get("cancelled_driver_user_ids", []))
        if previous is not None and int(previous) not in cancelled:
            cancelled.append(int(previous))
        patch = {"selected_candidate":None, "selected_offer":None, "driver_user_id":None, "cancelled_driver_user_ids":cancelled}
        session.execute(text("UPDATE core_order_mapping SET performer_local_user_id=NULL WHERE local_order_id=:id"), {"id":context.id})
        session.execute(text("UPDATE taxi_trips SET status='trip_cancelled',outcome='driver_cancelled',finished_at=CURRENT_TIMESTAMP WHERE order_id=:id AND finished_at IS NULL"), {"id":context.id})
    if action in {"order_register", "order_register_offer"}:
        session.execute(text("UPDATE core_order_mapping SET core_order_id=:core WHERE local_order_id=:id"), {"core": int(response["coreOrderId"]), "id": context.id})
    if response.get("bState") is not None:
        session.execute(text("UPDATE core_order_mapping SET b_state=:state WHERE local_order_id=:id"), {"state": int(response["bState"]), "id": context.id})
    if patch:
        OrderRepository(session).patch_metadata(context.id, patch)
