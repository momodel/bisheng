"""URL boundaries for credentials sent to a configured NEW API gateway."""

import posixpath
from urllib.parse import unquote, urlsplit


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
