"""Generate a self-signed HTTPS certificate for Sentinel.

The certificate's subject alternative names cover localhost, 127.0.0.1 and every
current LAN IPv4 address, so a tablet on the same network can open the app over
HTTPS (browsers only allow camera and microphone on secure origins).

Usage: python tools/make_cert.py [--force]
Prints the primary LAN IP on the last line. Regenerates only when the set of
addresses changed (or --force).
"""
from __future__ import annotations

import datetime as dt
import ipaddress
import json
import socket
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CERT_DIR = ROOT / "certs"


def lan_ips() -> list[str]:
    ips: set[str] = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    # The address used for the default route is the most useful one.
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    out = [ip for ip in ips if not ip.startswith("127.") and not ip.startswith("169.254.")]
    return sorted(out)


def primary_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        ips = lan_ips()
        return ips[0] if ips else "127.0.0.1"


def generate(ips: list[str]) -> None:
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Sentinel local")])
    sans = [x509.DNSName("localhost"), x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]
    sans += [x509.IPAddress(ipaddress.ip_address(ip)) for ip in ips]
    now = dt.datetime.now(dt.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(days=1))
        .not_valid_after(now + dt.timedelta(days=365))
        .add_extension(x509.SubjectAlternativeName(sans), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    CERT_DIR.mkdir(exist_ok=True)
    (CERT_DIR / "key.pem").write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )
    (CERT_DIR / "cert.pem").write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    (CERT_DIR / "ips.json").write_text(json.dumps(ips))


def main() -> None:
    ips = lan_ips()
    marker = CERT_DIR / "ips.json"
    need = "--force" in sys.argv or not (CERT_DIR / "cert.pem").exists() or not marker.exists()
    if not need:
        try:
            need = json.loads(marker.read_text()) != ips
        except (OSError, ValueError):
            need = True
    if need:
        generate(ips)
        print(f"certificate generated for localhost, 127.0.0.1, {', '.join(ips) or '(no LAN address)'}")
    else:
        print("certificate up to date")
    print(primary_ip())


if __name__ == "__main__":
    main()
