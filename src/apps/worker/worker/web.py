"""Web ingestion and URL normalization helpers."""

import ipaddress
import re
import socket
from typing import Optional
from urllib.parse import parse_qs, urljoin, urlparse, urlunparse
from urllib.robotparser import RobotFileParser

import httpx

from .app import settings


def _validate_public_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("URL scheme must be http or https")
    if not parsed.netloc:
        raise ValueError("URL must include a host")
    hostname = parsed.hostname or ""
    if not hostname:
        raise ValueError("URL must include a host")
    _ensure_public_host(hostname)
    return parsed.geturl()


def _ensure_public_host(hostname: str) -> None:
    ip_list: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
    try:
        ip_list.append(ipaddress.ip_address(hostname))
    except ValueError:
        try:
            infos = socket.getaddrinfo(hostname, None)
        except OSError as exc:
            raise ValueError("Unable to resolve host") from exc
        for info in infos:
            addr = info[4][0]
            try:
                ip_list.append(ipaddress.ip_address(addr))
            except ValueError:
                continue
    for addr in ip_list:
        if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved or addr.is_multicast or addr.is_unspecified:
            raise ValueError("URL resolves to a private or non-public address")


def _allowed_by_robots(url: str, user_agent: str) -> bool:
    parsed = urlparse(url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    try:
        with httpx.Client(timeout=settings.web_timeout_seconds) as client:
            resp = client.get(robots_url, headers={"User-Agent": user_agent}, follow_redirects=True)
            if resp.status_code >= 400:
                return True
            parser = RobotFileParser()
            parser.parse(resp.text.splitlines())
            return parser.can_fetch(user_agent, url)
    except Exception:
        return True


def _fetch_url_content(url: str) -> tuple[bytes, str, str]:
    headers = {"User-Agent": settings.web_user_agent}
    max_bytes = max(1, settings.web_max_bytes)
    current_url = url
    max_redirects = 5
    with httpx.Client(timeout=settings.web_timeout_seconds, follow_redirects=False) as client:
        for _ in range(max_redirects + 1):
            with client.stream("GET", current_url, headers=headers) as resp:
                if 300 <= resp.status_code < 400:
                    location = resp.headers.get("location")
                    if not location:
                        raise ValueError("Redirect without location header")
                    next_url = urljoin(current_url, location)
                    parsed = urlparse(next_url)
                    if not parsed.scheme or not parsed.netloc:
                        raise ValueError("Invalid redirect URL")
                    _ensure_public_host(parsed.hostname or "")
                    current_url = next_url
                    continue
                resp.raise_for_status()
                content_type = resp.headers.get("content-type", "")
                total = 0
                chunks: list[bytes] = []
                for chunk in resp.iter_bytes():
                    total += len(chunk)
                    if total > max_bytes:
                        raise ValueError("Web content exceeds size limit")
                    chunks.append(chunk)
                return b"".join(chunks), content_type, current_url
    raise ValueError("Too many redirects")


def _extract_web_text(raw: bytes, content_type: str) -> tuple[str, Optional[str]]:
    encoding = "utf-8"
    match = re.search(r"charset=([\w-]+)", content_type, re.IGNORECASE)
    if match:
        encoding = match.group(1)
    html = raw.decode(encoding, errors="ignore")
    lowered = content_type.lower()
    if "text/html" not in lowered and "application/xhtml" not in lowered and "<html" not in html.lower():
        cleaned = " ".join(html.split())
        return cleaned, None

    title = None
    text = ""
    try:
        from readability import Document

        doc = Document(html)
        title = doc.short_title() or doc.title()
        content_html = doc.summary()
        text = _html_to_text(content_html)
    except Exception:
        text = ""
    if not text:
        text = _html_to_text(html)
    cleaned = " ".join(text.split())
    return cleaned, title


def _html_to_text(html: str) -> str:
    try:
        from bs4 import BeautifulSoup
    except Exception:
        return re.sub(r"<[^>]+>", " ", html)
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    return soup.get_text(separator=" ")


def _build_pseudo_doc(title: Optional[str], url: str, crawl_at: str, content_type: str, text: str) -> str:
    header_title = title or url
    lines = [
        f"# {header_title}",
        f"Source: {url}",
        f"Crawled: {crawl_at}",
        f"Content-Type: {content_type or 'unknown'}",
        "",
        text,
    ]
    return "\n".join(lines)


def _canonicalize_web_url(url: str) -> Optional[str]:
    cleaned = (url or "").strip()
    if not cleaned:
        return None
    parsed = urlparse(cleaned)
    if parsed.scheme not in {"http", "https"}:
        return None
    host = (parsed.hostname or "").lower()
    if not host:
        return None
    if host.startswith("www."):
        host = host[4:]
    port = parsed.port
    if (parsed.scheme == "http" and port == 80) or (parsed.scheme == "https" and port == 443):
        port = None
    netloc = host if port is None else f"{host}:{port}"
    path = parsed.path or "/"
    path = re.sub(r"/{2,}", "/", path)
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    query = parse_qs(parsed.query, keep_blank_values=False)
    filtered_items: list[tuple[str, str]] = []
    for key, values in sorted(query.items()):
        normalized_key = key.lower()
        if normalized_key.startswith("utm_") or normalized_key in {"fbclid", "gclid"}:
            continue
        for value in values:
            if value:
                filtered_items.append((key, value))
    normalized_query = "&".join(f"{key}={value}" for key, value in filtered_items)
    return urlunparse((parsed.scheme.lower(), netloc, path, "", normalized_query, ""))


__all__ = [
    "_allowed_by_robots",
    "_build_pseudo_doc",
    "_canonicalize_web_url",
    "_ensure_public_host",
    "_extract_web_text",
    "_fetch_url_content",
    "_html_to_text",
    "_validate_public_url",
]
