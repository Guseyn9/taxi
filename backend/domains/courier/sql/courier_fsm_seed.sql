-- Courier/postamat FSM seed for the existing table-driven MySQL engine.
-- This file is idempotent and preserves the current delivery behavior.
-- It only makes the current courier domain explicit for FSM Platform.

START TRANSACTION;

INSERT INTO fsm_states (name, label)
SELECT v.name, v.label
FROM (
    SELECT 'order_created' AS name, 'Order created' AS label
    UNION ALL SELECT 'order_client_reserved_post1_and_post2', 'Client reserved post1 and post2'
    UNION ALL SELECT 'order_courier_reserved_post1_and_post2', 'Courier reserved post1 and post2'
    UNION ALL SELECT 'order_courier1_assigned', 'Courier1 assigned'
    UNION ALL SELECT 'order_parcel_submitted', 'Parcel submitted'
    UNION ALL SELECT 'order_courier_has_parcel', 'Courier has parcel'
    UNION ALL SELECT 'order_parcel_confirmed', 'Parcel confirmed'
    UNION ALL SELECT 'order_parcel_confirmed_post2', 'Parcel confirmed in post2'
    UNION ALL SELECT 'order_picked_up_from_post1', 'Picked up from post1'
    UNION ALL SELECT 'order_in_transit_to_post2', 'In transit to post2'
    UNION ALL SELECT 'order_arrived_at_post2', 'Arrived at post2'
    UNION ALL SELECT 'order_delivered_to_client', 'Delivered to client'
    UNION ALL SELECT 'order_courier2_assigned', 'Courier2 assigned'
    UNION ALL SELECT 'order_courier2_has_parcel', 'Courier2 has parcel'
    UNION ALL SELECT 'order_courier2_parcel_delivered', 'Courier2 parcel delivered'
    UNION ALL SELECT 'order_completed', 'Order completed'
    UNION ALL SELECT 'order_cancelled', 'Order cancelled'
    UNION ALL SELECT 'order_reservation_expired', 'Reservation expired'
    UNION ALL SELECT 'order_courier_failed', 'Courier failed'
    UNION ALL SELECT 'order_parcel_missing', 'Parcel missing'
    UNION ALL SELECT 'order_delivery_failed', 'Delivery failed'
    UNION ALL SELECT 'order_manual_intervention_required', 'Manual intervention required'
    UNION ALL SELECT 'trip_created', 'Trip created'
    UNION ALL SELECT 'trip_assigned', 'Trip assigned'
    UNION ALL SELECT 'trip_ready_for_pickup', 'Trip ready for pickup'
    UNION ALL SELECT 'trip_parcel_picked_up', 'Trip parcel picked up'
    UNION ALL SELECT 'trip_in_progress', 'Trip in progress'
    UNION ALL SELECT 'trip_arrived_at_destination', 'Trip arrived at destination'
    UNION ALL SELECT 'trip_parcel_delivered', 'Trip parcel delivered'
    UNION ALL SELECT 'trip_completed', 'Trip completed'
    UNION ALL SELECT 'trip_driver_not_found', 'Trip driver not found'
    UNION ALL SELECT 'trip_failed', 'Trip failed'
    UNION ALL SELECT 'trip_manual_intervention_required', 'Trip manual intervention required'
    UNION ALL SELECT 'locker_free', 'Locker free'
    UNION ALL SELECT 'locker_reserved', 'Locker reserved'
    UNION ALL SELECT 'locker_opened', 'Locker opened'
    UNION ALL SELECT 'locker_occupied', 'Locker occupied'
    UNION ALL SELECT 'locker_error', 'Locker error'
    UNION ALL SELECT 'locker_maintenance', 'Locker maintenance'
    UNION ALL SELECT 'locker_closed_empty', 'Locker closed empty'
    UNION ALL SELECT 'locker_parcel_submitted', 'Locker parcel submitted'
    UNION ALL SELECT 'locker_parcel_confirmed', 'Locker parcel confirmed'
    UNION ALL SELECT 'locker_parcel_missing', 'Locker parcel missing'
    UNION ALL SELECT 'locker_parcel_pickup_driver', 'Locker parcel pickup by driver'
    UNION ALL SELECT 'locker_parcel_pickup_recipient', 'Locker parcel pickup by recipient'
) v
WHERE NOT EXISTS (
    SELECT 1 FROM fsm_states s WHERE s.name = v.name
);

INSERT INTO fsm_actions (name, label)
SELECT v.name, v.label
FROM (
    SELECT 'locker_reserve_cell' AS name, 'Reserve locker cell' AS label
    UNION ALL SELECT 'locker_open_locker', 'Open locker'
    UNION ALL SELECT 'locker_close_locker', 'Close locker'
    UNION ALL SELECT 'locker_confirm_parcel_in', 'Confirm parcel in locker'
    UNION ALL SELECT 'locker_reset', 'Reset locker'
    UNION ALL SELECT 'locker_set_locker_to_maintenance', 'Set locker maintenance'
    UNION ALL SELECT 'locker_confirm_parcel_not_found', 'Confirm parcel not found'
    UNION ALL SELECT 'locker_cancel_reservation', 'Cancel locker reservation'
    UNION ALL SELECT 'locker_confirm_parcel_out', 'Confirm parcel out'
    UNION ALL SELECT 'locker_dont_closed', 'Locker not closed'
    UNION ALL SELECT 'locker_confirm_parcel_out_recipient', 'Confirm recipient parcel out'
    UNION ALL SELECT 'locker_close_pickup', 'Close locker after pickup'
    UNION ALL SELECT 'trip_assign_voditel', 'Assign driver'
    UNION ALL SELECT 'trip_start_trip', 'Start trip'
    UNION ALL SELECT 'trip_complete_trip', 'Complete trip'
    UNION ALL SELECT 'trip_start_pickup', 'Start pickup'
    UNION ALL SELECT 'trip_confirm_pickup', 'Confirm pickup'
    UNION ALL SELECT 'trip_confirm_delivery', 'Confirm delivery'
    UNION ALL SELECT 'trip_end_delivery', 'End delivery'
    UNION ALL SELECT 'trip_report_driver_not_found', 'Report driver not found'
    UNION ALL SELECT 'trip_report_failure', 'Report trip failure'
    UNION ALL SELECT 'trip_request_manual_intervention', 'Request trip manual intervention'
    UNION ALL SELECT 'trip_vzyat_reis', 'Take trip'
    UNION ALL SELECT 'order_timeout_reservation', 'Reservation timeout'
    UNION ALL SELECT 'order_assign_courier1_to_order', 'Assign courier1'
    UNION ALL SELECT 'order_timeout_confirmation', 'Confirmation timeout'
    UNION ALL SELECT 'order_client_will_deliver', 'Client will deliver'
    UNION ALL SELECT 'order_confirm_parcel_in', 'Confirm parcel in order'
    UNION ALL SELECT 'order_parcel_submitted', 'Order parcel submitted'
    UNION ALL SELECT 'order_courier_pickup_parcel', 'Courier pickup parcel'
    UNION ALL SELECT 'order_cancel_reservation', 'Cancel order reservation'
    UNION ALL SELECT 'order_reserve_for_client_A_to_B', 'Reserve for client A to B'
    UNION ALL SELECT 'order_reserve_for_courier_A_to_B', 'Reserve for courier A to B'
    UNION ALL SELECT 'order_pickup_by_voditel', 'Driver pickup parcel'
    UNION ALL SELECT 'order_start_transit', 'Start transit'
    UNION ALL SELECT 'order_arrive_at_post2', 'Arrive at post2'
    UNION ALL SELECT 'order_pickup_poluchatel', 'Recipient pickup parcel'
    UNION ALL SELECT 'order_delivered_parcel', 'Delivered parcel'
    UNION ALL SELECT 'order_assign_courier2_to_order', 'Assign courier2'
    UNION ALL SELECT 'order_courier2_pickup_parcel', 'Courier2 pickup parcel'
    UNION ALL SELECT 'order_courier2_delivered_parcel', 'Courier2 delivered parcel'
    UNION ALL SELECT 'order_report_parcel_missing', 'Report parcel missing'
    UNION ALL SELECT 'order_report_delivery_failed', 'Report delivery failed'
    UNION ALL SELECT 'order_request_manual_intervention', 'Request order manual intervention'
    UNION ALL SELECT 'order_courier1_cancel', 'Courier1 cancel'
    UNION ALL SELECT 'order_courier2_cancel', 'Courier2 cancel'
    UNION ALL SELECT 'order_timeout_no_pickup', 'No pickup timeout'
    UNION ALL SELECT 'order_recipient_confirmed', 'Recipient confirmed'
) v
WHERE NOT EXISTS (
    SELECT 1 FROM fsm_actions a WHERE a.name = v.name
);

INSERT INTO fsm_transitions (from_state_id, action_id, to_state_id)
SELECT fs_from.id, action.id, fs_to.id
FROM (
    SELECT 'order_created' AS from_state, 'order_reserve_for_client_A_to_B' AS action_name, 'order_client_reserved_post1_and_post2' AS to_state
    UNION ALL SELECT 'order_created', 'order_reserve_for_courier_A_to_B', 'order_courier_reserved_post1_and_post2'
    UNION ALL SELECT 'order_client_reserved_post1_and_post2', 'order_timeout_reservation', 'order_reservation_expired'
    UNION ALL SELECT 'order_courier_reserved_post1_and_post2', 'order_timeout_reservation', 'order_reservation_expired'
    UNION ALL SELECT 'order_client_reserved_post1_and_post2', 'order_cancel_reservation', 'order_cancelled'
    UNION ALL SELECT 'order_courier_reserved_post1_and_post2', 'order_cancel_reservation', 'order_cancelled'
    UNION ALL SELECT 'order_client_reserved_post1_and_post2', 'order_confirm_parcel_in', 'order_parcel_confirmed'
    UNION ALL SELECT 'order_courier_reserved_post1_and_post2', 'order_assign_courier1_to_order', 'order_courier1_assigned'
    UNION ALL SELECT 'order_courier1_assigned', 'order_timeout_confirmation', 'order_courier_failed'
    UNION ALL SELECT 'order_courier1_assigned', 'order_courier_pickup_parcel', 'order_courier_has_parcel'
    UNION ALL SELECT 'order_courier1_assigned', 'order_courier1_cancel', 'order_cancelled'
    UNION ALL SELECT 'order_courier_has_parcel', 'order_confirm_parcel_in', 'order_parcel_confirmed'
    UNION ALL SELECT 'order_parcel_confirmed', 'order_report_parcel_missing', 'order_parcel_missing'
    UNION ALL SELECT 'order_parcel_confirmed_post2', 'order_report_parcel_missing', 'order_parcel_missing'
    UNION ALL SELECT 'order_parcel_submitted', 'order_pickup_by_voditel', 'order_picked_up_from_post1'
    UNION ALL SELECT 'order_picked_up_from_post1', 'order_start_transit', 'order_in_transit_to_post2'
    UNION ALL SELECT 'order_in_transit_to_post2', 'order_arrive_at_post2', 'order_arrived_at_post2'
    UNION ALL SELECT 'order_arrived_at_post2', 'order_confirm_parcel_in', 'order_parcel_confirmed_post2'
    UNION ALL SELECT 'order_parcel_confirmed_post2', 'order_pickup_poluchatel', 'order_delivered_to_client'
    UNION ALL SELECT 'order_delivered_to_client', 'order_delivered_parcel', 'order_completed'
    UNION ALL SELECT 'order_parcel_confirmed_post2', 'order_assign_courier2_to_order', 'order_courier2_assigned'
    UNION ALL SELECT 'order_courier2_assigned', 'order_courier2_pickup_parcel', 'order_courier2_has_parcel'
    UNION ALL SELECT 'order_courier2_has_parcel', 'order_courier2_delivered_parcel', 'order_courier2_parcel_delivered'
    UNION ALL SELECT 'order_courier2_parcel_delivered', 'order_recipient_confirmed', 'order_completed'
    UNION ALL SELECT 'order_courier2_assigned', 'order_courier2_cancel', 'order_arrived_at_post2'
    UNION ALL SELECT 'order_courier2_has_parcel', 'order_courier2_cancel', 'order_arrived_at_post2'
    UNION ALL SELECT 'order_courier2_assigned', 'order_timeout_no_pickup', 'order_delivery_failed'
    UNION ALL SELECT 'order_courier_has_parcel', 'order_report_delivery_failed', 'order_delivery_failed'
    UNION ALL SELECT 'order_in_transit_to_post2', 'order_report_delivery_failed', 'order_delivery_failed'
    UNION ALL SELECT 'order_courier2_has_parcel', 'order_report_delivery_failed', 'order_delivery_failed'
    UNION ALL SELECT 'trip_created', 'trip_vzyat_reis', 'trip_assigned'
    UNION ALL SELECT 'trip_created', 'trip_assign_voditel', 'trip_assigned'
    UNION ALL SELECT 'trip_assigned', 'trip_start_pickup', 'trip_ready_for_pickup'
    UNION ALL SELECT 'trip_ready_for_pickup', 'trip_confirm_pickup', 'trip_parcel_picked_up'
    UNION ALL SELECT 'trip_parcel_picked_up', 'trip_start_trip', 'trip_in_progress'
    UNION ALL SELECT 'trip_in_progress', 'trip_end_delivery', 'trip_arrived_at_destination'
    UNION ALL SELECT 'trip_arrived_at_destination', 'trip_confirm_delivery', 'trip_parcel_delivered'
    UNION ALL SELECT 'trip_parcel_delivered', 'trip_complete_trip', 'trip_completed'
    UNION ALL SELECT 'trip_in_progress', 'trip_complete_trip', 'trip_arrived_at_destination'
    UNION ALL SELECT 'trip_created', 'trip_report_driver_not_found', 'trip_driver_not_found'
    UNION ALL SELECT 'trip_created', 'trip_report_failure', 'trip_failed'
    UNION ALL SELECT 'trip_in_progress', 'trip_report_failure', 'trip_failed'
    UNION ALL SELECT 'trip_ready_for_pickup', 'trip_report_failure', 'trip_failed'
    UNION ALL SELECT 'trip_parcel_picked_up', 'trip_report_failure', 'trip_failed'
    UNION ALL SELECT 'trip_arrived_at_destination', 'trip_report_failure', 'trip_failed'
    UNION ALL SELECT 'trip_created', 'trip_request_manual_intervention', 'trip_manual_intervention_required'
    UNION ALL SELECT 'trip_in_progress', 'trip_request_manual_intervention', 'trip_manual_intervention_required'
    UNION ALL SELECT 'trip_ready_for_pickup', 'trip_request_manual_intervention', 'trip_manual_intervention_required'
    UNION ALL SELECT 'trip_parcel_picked_up', 'trip_request_manual_intervention', 'trip_manual_intervention_required'
    UNION ALL SELECT 'trip_arrived_at_destination', 'trip_request_manual_intervention', 'trip_manual_intervention_required'
    UNION ALL SELECT 'trip_parcel_delivered', 'trip_request_manual_intervention', 'trip_manual_intervention_required'
    UNION ALL SELECT 'locker_free', 'locker_reserve_cell', 'locker_reserved'
    UNION ALL SELECT 'locker_reserved', 'locker_open_locker', 'locker_opened'
    UNION ALL SELECT 'locker_parcel_missing', 'locker_close_locker', 'locker_closed_empty'
    UNION ALL SELECT 'locker_parcel_confirmed', 'locker_close_locker', 'locker_occupied'
    UNION ALL SELECT 'locker_parcel_pickup_driver', 'locker_close_locker', 'locker_closed_empty'
    UNION ALL SELECT 'locker_parcel_pickup_recipient', 'locker_close_locker', 'locker_closed_empty'
    UNION ALL SELECT 'locker_opened', 'locker_close_pickup', 'locker_closed_empty'
    UNION ALL SELECT 'locker_closed_empty', 'locker_reset', 'locker_free'
    UNION ALL SELECT 'locker_maintenance', 'locker_reset', 'locker_free'
    UNION ALL SELECT 'locker_error', 'locker_reset', 'locker_free'
    UNION ALL SELECT 'locker_free', 'locker_set_locker_to_maintenance', 'locker_maintenance'
    UNION ALL SELECT 'locker_error', 'locker_set_locker_to_maintenance', 'locker_maintenance'
    UNION ALL SELECT 'locker_reserved', 'locker_cancel_reservation', 'locker_free'
    UNION ALL SELECT 'locker_opened', 'locker_confirm_parcel_in', 'locker_parcel_submitted'
    UNION ALL SELECT 'locker_opened', 'locker_confirm_parcel_not_found', 'locker_parcel_missing'
    UNION ALL SELECT 'locker_opened', 'locker_confirm_parcel_out', 'locker_parcel_pickup_driver'
    UNION ALL SELECT 'locker_opened', 'locker_confirm_parcel_out_recipient', 'locker_parcel_pickup_recipient'
    UNION ALL SELECT 'locker_opened', 'locker_dont_closed', 'locker_error'
) v
JOIN fsm_states fs_from ON fs_from.name = v.from_state
JOIN fsm_actions action ON action.name = v.action_name
JOIN fsm_states fs_to ON fs_to.name = v.to_state
WHERE NOT EXISTS (
    SELECT 1
    FROM fsm_transitions t
    JOIN fsm_states existing_from ON existing_from.id = t.from_state_id
    JOIN fsm_actions existing_action ON existing_action.id = t.action_id
    JOIN fsm_states existing_to ON existing_to.id = t.to_state_id
    WHERE existing_from.name = v.from_state
      AND existing_action.name = v.action_name
      AND existing_to.name = v.to_state
);

COMMIT;
