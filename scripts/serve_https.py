"""Serve the site over HTTPS on the local Wi-Fi so phones allow geolocation.

Usage:  python scripts/serve_https.py [port]

Browsers refuse location on pages whose certificate they don't trust, so this
creates a small personal certificate authority (CA) once. Install that CA on the
phone (download it from https://<laptop-ip>:<port>/ca.crt) and the phone then
fully trusts this server. Keys live outside the project, in %LOCALAPPDATA%.
"""
import datetime
import http.server
import ipaddress
import os
import socket
import ssl
import sys

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CERT_DIR = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "kjs-dev-cert")
CA_CRT, CA_KEY = os.path.join(CERT_DIR, "ca.crt"), os.path.join(CERT_DIR, "ca.key")
CRT, KEY = os.path.join(CERT_DIR, "lan.crt"), os.path.join(CERT_DIR, "lan.key")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8443
UTC = datetime.timezone.utc


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))  # no packets sent; just picks the outbound interface
        return s.getsockname()[0]
    finally:
        s.close()


def write_pem(path, data):
    with open(path, "wb") as f:
        f.write(data)


def key_pem(key):
    return key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())


def load_ca():
    if os.path.exists(CA_CRT) and os.path.exists(CA_KEY):
        with open(CA_CRT, "rb") as f:
            crt = x509.load_pem_x509_certificate(f.read())
        with open(CA_KEY, "rb") as f:
            key = serialization.load_pem_private_key(f.read(), None)
        return crt, key
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "KJS Dev Local CA")])
    now = datetime.datetime.now(UTC)
    crt = (
        x509.CertificateBuilder()
        .subject_name(name).issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(now + datetime.timedelta(days=3650))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(x509.KeyUsage(digital_signature=True, key_cert_sign=True, crl_sign=True, content_commitment=False,
                                     key_encipherment=False, data_encipherment=False, key_agreement=False,
                                     encipher_only=False, decipher_only=False), critical=True)
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
        .sign(key, hashes.SHA256())
    )
    os.makedirs(CERT_DIR, exist_ok=True)
    write_pem(CA_KEY, key_pem(key))
    write_pem(CA_CRT, crt.public_bytes(serialization.Encoding.PEM))
    return crt, key


def leaf_ok(ip, ca):
    if not (os.path.exists(CRT) and os.path.exists(KEY)):
        return False
    with open(CRT, "rb") as f:
        crt = x509.load_pem_x509_certificate(f.read())
    ips = crt.extensions.get_extension_for_class(x509.SubjectAlternativeName).value.get_values_for_type(x509.IPAddress)
    return (crt.issuer == ca.subject and ipaddress.ip_address(ip) in ips
            and crt.not_valid_after_utc > datetime.datetime.now(UTC) + datetime.timedelta(days=7))


def make_leaf(ip, ca, ca_key):
    key = ec.generate_private_key(ec.SECP256R1())
    now = datetime.datetime.now(UTC)
    crt = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, ip)]))
        .issuer_name(ca.subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(now + datetime.timedelta(days=365))
        .add_extension(x509.SubjectAlternativeName([
            x509.IPAddress(ipaddress.ip_address(ip)),
            x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
            x509.DNSName("localhost"),
        ]), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
        .sign(ca_key, hashes.SHA256())
    )
    write_pem(KEY, key_pem(key))
    write_pem(CRT, crt.public_bytes(serialization.Encoding.PEM))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/ca.crt":
            with open(CA_CRT, "rb") as f:
                der = x509.load_pem_x509_certificate(f.read()).public_bytes(serialization.Encoding.DER)
            self.send_response(200)
            self.send_header("Content-Type", "application/x-x509-ca-cert")
            self.send_header("Content-Disposition", 'attachment; filename="kjs-dev-ca.crt"')
            self.send_header("Content-Length", str(len(der)))
            self.end_headers()
            self.wfile.write(der)
            return
        if any(part.startswith(".") for part in path.split("/") if part):
            self.send_error(404)
            return
        super().do_GET()

    do_HEAD = do_GET


def main():
    ip = lan_ip()
    ca, ca_key = load_ca()
    if not leaf_ok(ip, ca):
        make_leaf(ip, ca, ca_key)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(CRT, KEY)
    httpd = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    print(f"Serving {ROOT} over HTTPS")
    print(f"  1. On the phone, download the CA:  https://{ip}:{PORT}/ca.crt  (tap through the warning once)")
    print("  2. Install it as a CA certificate (see the instructions in chat), then reopen:")
    print(f"     Live map: https://{ip}:{PORT}/pune.html")
    print(f"     Tracker:  https://{ip}:{PORT}/track.html", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
