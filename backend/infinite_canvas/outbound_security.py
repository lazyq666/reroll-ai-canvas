"""Guard server-side HTTP downloads from private-network targets."""

from __future__ import annotations

import ipaddress
import socket
import urllib.parse
from typing import Callable

import httpx
import requests


REDIRECT_STATUSES = {301, 302, 303, 307, 308}


class OutboundUrlError(ValueError):
    """Raised when an outbound URL could reach a non-public network."""


def validate_public_http_url(
    url: str,
    *,
    resolver: Callable = socket.getaddrinfo,
) -> str:
    text = str(url or "").strip()
    try:
        parsed = urllib.parse.urlsplit(text)
        port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80)
    except ValueError as exc:
        raise OutboundUrlError("远程地址格式不正确") from exc
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        raise OutboundUrlError("远程地址仅支持 http 或 https")
    if parsed.username is not None or parsed.password is not None:
        raise OutboundUrlError("远程地址不能包含用户名或密码")
    hostname = parsed.hostname.rstrip(".").lower()
    if hostname == "localhost" or hostname.endswith(".localhost"):
        raise OutboundUrlError("不允许访问本机或局域网地址")
    try:
        answers = resolver(hostname, port, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise OutboundUrlError(f"无法解析远程地址：{hostname}") from exc
    addresses = {
        str(answer[4][0]).split("%", 1)[0]
        for answer in answers
        if len(answer) >= 5 and answer[4]
    }
    if not addresses:
        raise OutboundUrlError(f"无法解析远程地址：{hostname}")
    for raw_address in addresses:
        try:
            address = ipaddress.ip_address(raw_address)
        except ValueError as exc:
            raise OutboundUrlError("远程地址解析结果不正确") from exc
        if not address.is_global:
            raise OutboundUrlError("不允许访问本机、局域网或保留网络地址")
    return text


def requests_get_public(
    url: str,
    *,
    max_redirects: int = 5,
    **kwargs,
) -> requests.Response:
    current = validate_public_http_url(url)
    kwargs.pop("allow_redirects", None)
    for _ in range(max_redirects + 1):
        response = requests.get(current, allow_redirects=False, **kwargs)
        if response.status_code not in REDIRECT_STATUSES:
            return response
        location = str(response.headers.get("location") or "").strip()
        response.close()
        if not location:
            raise OutboundUrlError("远程服务器返回了无效跳转")
        current = validate_public_http_url(urllib.parse.urljoin(current, location))
    raise OutboundUrlError("远程地址跳转次数过多")


async def httpx_get_public(
    client: httpx.AsyncClient,
    url: str,
    *,
    max_redirects: int = 5,
    **kwargs,
) -> httpx.Response:
    current = validate_public_http_url(url)
    kwargs.pop("follow_redirects", None)
    for _ in range(max_redirects + 1):
        response = await client.get(current, follow_redirects=False, **kwargs)
        if response.status_code not in REDIRECT_STATUSES:
            return response
        location = str(response.headers.get("location") or "").strip()
        await response.aclose()
        if not location:
            raise OutboundUrlError("远程服务器返回了无效跳转")
        current = validate_public_http_url(urllib.parse.urljoin(current, location))
    raise OutboundUrlError("远程地址跳转次数过多")


__all__ = [
    "OutboundUrlError",
    "httpx_get_public",
    "requests_get_public",
    "validate_public_http_url",
]
