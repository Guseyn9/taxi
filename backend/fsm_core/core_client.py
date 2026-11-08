"""The tenant's FormData API. Never include remote bodies in exceptions/logs."""
from __future__ import annotations

import os
import json
from dataclasses import dataclass, field
from urllib.parse import urlsplit

import httpx
from cryptography.fernet import Fernet, MultiFernet, InvalidToken

from .errors import AuthenticationError, AuthenticationUnavailable


@dataclass(frozen=True)
class UserCredentials:
    token: str = field(repr=False)
    u_hash: str = field(repr=False)

    def __post_init__(self):
        if not isinstance(self.token, str) or not isinstance(self.u_hash, str) or not self.token or not self.u_hash or max(len(self.token), len(self.u_hash)) > 4096:
            raise AuthenticationError("A valid token/u_hash pair is required")


class CredentialCipher:
    def __init__(self, keys):
        self.cipher = MultiFernet([Fernet(key) for key in keys])

    @classmethod
    def from_env(cls):
        keys = os.getenv("FSM_CREDENTIAL_KEYS", "").split(",")
        if not all(keys):
            raise RuntimeError("FSM_CREDENTIAL_KEYS is required (Fernet keys, newest first)")
        return cls(keys)

    def encrypt(self, credentials, *, private_payload=None):
        return self.cipher.encrypt(json.dumps({"token": credentials.token, "u_hash": credentials.u_hash, "privatePayload":private_payload or {}}).encode()).decode()

    def decrypt(self, value):
        return self.decrypt_bundle(value)[0]

    def decrypt_bundle(self, value):
        try:
            data = json.loads(self.cipher.decrypt(value.encode(), ttl=3600))
            private = data.get("privatePayload") or {}
            if not isinstance(private, dict):
                raise ValueError()
            return UserCredentials(data["token"], data["u_hash"]), private
        except (InvalidToken, ValueError, KeyError, TypeError, AttributeError):
            raise AuthenticationError("Stored credentials expired or cannot be decrypted") from None


class CoreRefused(Exception):
    """Definitive rejection; its public message never contains a server body."""
    def __init__(self, code="CORE_REJECTED"):
        self.code = code
        super().__init__(code)


class CoreUnavailable(Exception):
    pass


class CoreClient:
    def __init__(self, base_url, *, transport=None, timeout=10):
        parsed = urlsplit(base_url)
        if parsed.query or parsed.fragment or parsed.username or parsed.password or not parsed.netloc:
            raise ValueError("Core base URL must have no credentials, query or fragment")
        if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "mock-core"}):
            raise ValueError("Core requires HTTPS outside the local stand")
        self.base_url = base_url.rstrip("/")
        self.client = httpx.Client(timeout=timeout, transport=transport, follow_redirects=False)

    @classmethod
    def from_env(cls):
        return cls(os.environ["IBRONEVIK_BASE_URL"], timeout=float(os.getenv("CORE_API_TIMEOUT_SECONDS", "10")))

    def post(self, path, credentials, fields=None):
        if not path.startswith("/") or path.startswith("//") or "?" in path or ".." in path:
            raise ValueError("Invalid Core path")
        values = dict(fields or {})
        values.update(token=credentials.token, u_hash=credentials.u_hash)
        try:
            response = self.client.post(self.base_url + path, files={k: (None, str(v)) for k, v in values.items()})
            if response.status_code >= 500 or response.status_code == 429:
                raise CoreUnavailable("Core temporarily unavailable")
            if response.status_code in {401, 403}:
                raise CoreRefused("AUTHORIZATION_FAILED")
            if response.status_code != 200:
                raise CoreRefused()
            result = response.json()
        except (httpx.HTTPError, ValueError):
            raise CoreUnavailable("Core response unavailable or invalid") from None
        business_code = str(result.get('code', '')) if isinstance(result, dict) else ''
        if business_code.isdigit() and (500 <= int(business_code) < 600 or int(business_code) == 429):
            raise CoreUnavailable("Core temporarily unavailable")
        if not isinstance(result, dict) or str(result.get("code")) != "200" or result.get("status") != "success":
            # Legacy API often returns business/auth failures with HTTP 200/404.
            message = str(result.get("message", "")).lower() if isinstance(result, dict) else ""
            auth = any(word in message for word in ("unauthorized", "invalid token", "wrong token", "expired token", "token expired", "wrong user hash", "invalid user hash"))
            raise CoreRefused("AUTHORIZATION_FAILED" if auth else "CORE_REJECTED")
        return result

    def authorize(self, credentials):
        try:
            result = self.post("/user/authorized", credentials, {"au": "s"})
        except CoreRefused:
            raise AuthenticationError("Session is invalid or expired") from None
        except CoreUnavailable:
            raise AuthenticationUnavailable("Authentication service unavailable") from None
        # c_api.php supplies auth_user, not an unverified identity from the client.
        user = result.get("auth_user")
        if not isinstance(user, dict):
            data = result.get("data")
            users = data.get("user") if isinstance(data, dict) else None
            user = next(iter(users.values())) if isinstance(users, dict) and len(users) == 1 else None
        try:
            uid, role = int(user["u_id"]), int(user["u_role"])
            if uid <= 0 or role not in {1, 2, 3}:
                raise ValueError()
            ban = user.get("u_ban", "0")
            if isinstance(ban, dict):
                ban = ban.get("auth")
            if str(ban) not in {"", "0", "None"}:
                raise ValueError()
            if str(user.get("u_active", "1")) != "1":
                raise ValueError()
            return uid, {1: "client", 2: "driver", 3: "admin"}[role]
        except (TypeError, KeyError, ValueError):
            raise AuthenticationError("Core did not confirm an active supported identity") from None

    def close(self):
        self.client.close()
