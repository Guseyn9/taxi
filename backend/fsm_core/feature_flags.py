"""Non-secret rollout policy; operators may atomically replace a mounted JSON file."""
import json
import os
from pathlib import Path

INTENTS = frozenset({
    'order_registered', 'vote_requested', 'offer_requested',
    'direct_assignment_requested', 'candidate_selected', 'candidate_released',
    'offer_selected', 'driver_arrived', 'ride_started', 'ride_finished',
    'cancel_requested', 'driver_cancel_requested',
})


def read_feature_flags():
    path = os.getenv('FSM_FEATURES_FILE', '').strip()
    if path:
        # A bounded read, even when the operator accidentally mounts a large file.
        with Path(path).open('rb') as stream:
            raw = stream.read(16385)
        if len(raw) > 16384:
            raise ValueError('Rollout configuration exceeds its size limit')
        config = json.loads(raw)
    else:
        configured = os.getenv('FSM_ENABLED_INTENTS', '')
        enabled = [v.strip() for v in configured.split(',') if v.strip() and v.strip() != 'none']
        config = {'schemaVersion': 1, 'enabledIntents': enabled}
    if not isinstance(config, dict) or config.get('schemaVersion') != 1:
        raise ValueError('Invalid rollout schema')
    enabled = config.get('enabledIntents')
    if not isinstance(enabled, list) or len(enabled) > len(INTENTS) or any(not isinstance(v, str) or v not in INTENTS for v in enabled):
        raise ValueError('Invalid rollout intents')
    return {'schemaVersion': 1, 'enabledIntents': sorted(set(enabled))}
