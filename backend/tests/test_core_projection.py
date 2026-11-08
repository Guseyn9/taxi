"""Core read projection keeps the offer facts needed by our existing frontend."""
import json
import unittest
from domains.taxi.core_projection import booking_projection


class CoreProjectionTests(unittest.TestCase):
    def test_selected_offer_preserves_price_eta_and_safe_driver_fields(self):
        booking = {
            'b_id': '901', 'u_id': '100', 'b_state': '1',
            'b_options': {'offer_mode': 'OFFER'},
            'token': 'must-not-be-projected',
            'drivers': [{'u_id': '205', 'c_id': '10', 'c_state': '3',
                'c_price': '50', 'token': 'private-driver-token',
                'c_options': json.dumps({'performers_price': '75.50',
                    'driver_offer_eta': '180', 'private_token': 'discard'})}],
        }
        cid, owner, driver, state, metadata = booking_projection(booking)
        self.assertEqual((cid, owner, driver, state), (901, 100, 205, 'order_driver_assigned'))
        self.assertEqual(metadata['selected_offer']['price'], '75.50')
        self.assertEqual(metadata['selected_offer']['eta'], '180')
        self.assertEqual(metadata['driver_records']['205']['c_options'],
            {'performers_price': '75.50', 'driver_offer_eta': '180'})
        self.assertNotIn('private', json.dumps(metadata))
        self.assertNotIn('must-not-be-projected', json.dumps(metadata))

    def test_cancelled_driver_leaves_passenger_order_available(self):
        for mode, expected in [('DIRECT', 'order_created'), ('VOTE', 'order_vote_waiting_candidates'), ('OFFER', 'order_offer_waiting')]:
            with self.subTest(mode=mode):
                booking = {'b_id': 901, 'u_id': 100, 'b_state': 1,
                    'b_confirm_state': 1, 'b_voting': mode == 'VOTE',
                    'b_options': {'offer_mode': mode},
                    'drivers': [{'u_id': 205, 'c_state': 2}]}
                _, _, driver, state, metadata = booking_projection(booking)
                self.assertIsNone(driver)
                self.assertEqual(state, expected)
                self.assertEqual(metadata['cancelled_driver_user_ids'], [205])
