"""URL boundaries for credentials sent to a configured NEW API gateway."""

import posixpath
from urllib.parse import unquote, urlsplit

from bisheng.common.errcode.user import NewApiInsufficientCreditsError


def check_personal_model_error(error: Exception, personal_key_used: bool) -> None:
    """Apply the personal billing contract only to NEW API invalid-token responses."""
    if not personal_key_used or getattr(error, "status_code", None) != 401:
        return
    body = getattr(error, "body", None)
    if not isinstance(body, dict):
        return
    details = body.get("error", body)
    if not isinstance(details, dict):
        return
    message = details.get("message", "")
    if (
        details.get("type") == "new_api_error"
        and isinstance(message, str)
        and (message == "Invalid token" or message.startswith("Invalid token (request id:"))
    ):
        raise NewApiInsufficientCreditsError() from error


def gateway_identity(url: str) -> tuple[str, str, int, str]:
    if any(ord(char) < 32 for char in url):
        raise ValueError("NEW API URL cannot contain control characters")
    parsed = urlsplit(url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("NEW API requires an absolute HTTP(S) URL without credentials")
    if parsed.query or parsed.fragment or "\\" in url:
        raise ValueError("NEW API base URL cannot contain a query, fragment or backslash")
    path = posixpath.normpath(unquote(parsed.path or "/")).rstrip("/")
    return parsed.scheme, parsed.hostname.lower(), parsed.port or (443 if parsed.scheme == "https" else 80), path


def matches_gateway(url: str, base_url: str) -> bool:
    if not base_url:
        return False
    gateway = gateway_identity(base_url)
    try:
        parsed = urlsplit(url)
        target = gateway_identity(parsed._replace(query="", fragment="").geturl())
    except (TypeError, ValueError):
        return False
    return target[:3] == gateway[:3] and (target[3] == gateway[3] or target[3].startswith(gateway[3] + "/"))
