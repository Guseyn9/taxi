import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from fsm_core.feature_flags import read_feature_flags, INTENTS
from domains.taxi.create_api import create_taxi_router
from fastapi import FastAPI


class FeatureFlagTests(unittest.TestCase):
    def test_defaults_and_environment_canary(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(read_feature_flags()['enabledIntents'], [])
        with patch.dict(os.environ, {'FSM_ENABLED_INTENTS': 'driver_cancel_requested'}, clear=True):
            self.assertEqual(read_feature_flags()['enabledIntents'], ['driver_cancel_requested'])

    def test_mounted_file_changes_without_restart_and_failure_never_enables(self):
        app = FastAPI()
        app.include_router(create_taxi_router())
        client = TestClient(app)
        with TemporaryDirectory() as temp, patch.dict(os.environ, {'FSM_FEATURES_FILE': str(Path(temp)/'flags.json')}, clear=True):
            path = Path(temp)/'flags.json'
            self.assertEqual(client.get('/api/taxi/features').status_code, 503)
            for enabled in [['driver_cancel_requested'], []]:
                replacement = Path(temp)/'rollout.next.json'
                replacement.write_text(json.dumps({'schemaVersion': 1, 'enabledIntents': enabled}))
                replacement.replace(path)
                response = client.get('/api/taxi/features')
                self.assertEqual(response.json()['enabledIntents'], enabled)
                self.assertEqual(response.headers['cache-control'], 'no-store')
            for content in ['invalid', '{"schemaVersion":1,"enabledIntents":["unknown"]}', 'x'*16385]:
                path.write_text(content)
                response = client.get('/api/taxi/features')
                self.assertEqual(response.status_code, 503)
                self.assertNotIn(str(path), response.text)
