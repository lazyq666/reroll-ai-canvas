import socket
import unittest
from unittest.mock import Mock, patch

from infinite_canvas.outbound_security import (
    OutboundUrlError,
    requests_get_public,
    validate_public_http_url,
)


def resolver_for(*addresses):
    def resolve(_host, port, type=socket.SOCK_STREAM):
        return [
            (socket.AF_INET6 if ":" in address else socket.AF_INET, type, 6, "", (address, port))
            for address in addresses
        ]

    return resolve


class OutboundSecurityTests(unittest.TestCase):
    def test_public_https_url_is_allowed(self):
        url = validate_public_http_url(
            "https://cdn.example.com/image.png",
            resolver=resolver_for("93.184.216.34"),
        )
        self.assertEqual(url, "https://cdn.example.com/image.png")

    def test_loopback_private_and_link_local_targets_are_rejected(self):
        cases = (
            ("http://127.0.0.1:3000/private", resolver_for("127.0.0.1")),
            ("http://router.example/", resolver_for("192.168.1.1")),
            ("http://metadata.example/", resolver_for("169.254.169.254")),
            ("http://ipv6.example/", resolver_for("::1")),
        )
        for url, resolver in cases:
            with self.subTest(url=url):
                with self.assertRaises(OutboundUrlError):
                    validate_public_http_url(url, resolver=resolver)

    def test_hostname_with_mixed_public_and_private_answers_is_rejected(self):
        with self.assertRaises(OutboundUrlError):
            validate_public_http_url(
                "https://rebinding.example/file",
                resolver=resolver_for("93.184.216.34", "10.0.0.5"),
            )

    def test_credentials_and_non_http_schemes_are_rejected(self):
        for url in (
            "http://user:password@example.com/file",
            "file:///etc/passwd",
            "ftp://example.com/file",
        ):
            with self.subTest(url=url):
                with self.assertRaises(OutboundUrlError):
                    validate_public_http_url(
                        url,
                        resolver=resolver_for("93.184.216.34"),
                    )

    @patch("infinite_canvas.outbound_security.requests.get")
    @patch(
        "infinite_canvas.outbound_security.validate_public_http_url"
    )
    def test_redirect_targets_are_validated_again(
        self,
        validate_url,
        requests_get,
    ):
        validate_url.side_effect = [
            "https://public.example/file",
            OutboundUrlError("不允许访问本机或局域网地址"),
        ]
        redirect = Mock(
            status_code=302,
            headers={"location": "http://127.0.0.1:3000/private"},
        )
        requests_get.return_value = redirect

        with self.assertRaises(OutboundUrlError):
            requests_get_public("https://public.example/file", stream=True)

        redirect.close.assert_called_once()
        self.assertEqual(validate_url.call_count, 2)


if __name__ == "__main__":
    unittest.main()
