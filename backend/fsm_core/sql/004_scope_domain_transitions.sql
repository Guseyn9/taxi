-- Stage 3: assign legacy transition rows to their owning service/entity type.
-- Apply after courier and taxi domain seeds.

UPDATE fsm_transitions t
JOIN fsm_actions a ON a.id = t.action_id
SET t.service = 'taxi', t.entity_type = 'order'
WHERE a.name IN (
    'order_publish_vote',
    'order_select_candidate',
    'order_release_candidate',
    'order_cancel_by_client',
    'order_no_show',
    'order_arrive',
    'order_start',
    'order_finish',
    'order_assign_direct',
    'order_publish_offer',
    'order_select_offer',
    'order_expire',
    'order_interrupt_ride',
    'order_cancel_by_driver',
    'order_confirm_driver_cancel',
    'order_revert_driver_cancel_to_vote_assigned',
    'order_revert_driver_cancel_to_assigned',
    'order_revert_driver_cancel_to_arrived'
);

UPDATE fsm_transitions t
JOIN fsm_actions a ON a.id = t.action_id
SET t.service = 'courier',
    t.entity_type = CASE
        WHEN a.name LIKE 'order\_%' THEN 'order'
        WHEN a.name LIKE 'trip\_%' THEN 'trip'
        WHEN a.name LIKE 'locker\_%' THEN 'locker'
        ELSE t.entity_type
    END
WHERE a.name IN (
    'order_timeout_reservation',
    'order_assign_courier1_to_order',
    'order_timeout_confirmation',
    'order_client_will_deliver',
    'order_confirm_parcel_in',
    'order_parcel_submitted',
    'order_courier_pickup_parcel',
    'order_cancel_reservation',
    'order_reserve_for_client_A_to_B',
    'order_reserve_for_courier_A_to_B',
    'order_pickup_by_voditel',
    'order_start_transit',
    'order_arrive_at_post2',
    'order_pickup_poluchatel',
    'order_delivered_parcel',
    'order_assign_courier2_to_order',
    'order_courier2_pickup_parcel',
    'order_courier2_delivered_parcel',
    'order_report_parcel_missing',
    'order_report_delivery_failed',
    'order_request_manual_intervention',
    'order_courier1_cancel',
    'order_courier2_cancel',
    'order_timeout_no_pickup',
    'order_recipient_confirmed',
    'trip_assign_voditel',
    'trip_start_trip',
    'trip_complete_trip',
    'trip_start_pickup',
    'trip_confirm_pickup',
    'trip_confirm_delivery',
    'trip_end_delivery',
    'trip_report_driver_not_found',
    'trip_report_failure',
    'trip_request_manual_intervention',
    'trip_vzyat_reis',
    'locker_reserve_cell',
    'locker_open_locker',
    'locker_close_locker',
    'locker_confirm_parcel_in',
    'locker_reset',
    'locker_set_locker_to_maintenance',
    'locker_confirm_parcel_not_found',
    'locker_cancel_reservation',
    'locker_confirm_parcel_out',
    'locker_dont_closed',
    'locker_confirm_parcel_out_recipient',
    'locker_close_pickup'
);

