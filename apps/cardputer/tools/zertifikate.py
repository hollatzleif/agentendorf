"""Erzeugt src/zertifikate.h: die Wurzelzertifikate, denen der Cardputer bei HTTPS vertraut.

ISRG Root X1/X2 (Let's Encrypt - das nimmt Caddy normalerweise) und USERTrust RSA/ECC
(ZeroSSL, Caddys Ausweich-Aussteller). Quelle: der Zertifikatsspeicher des Rechners (/etc/ssl/certs).
Aufruf (aus apps/cardputer/):  python3 tools/zertifikate.py
"""
from __future__ import annotations

import hashlib
import ssl
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
QUELLE = Path("/etc/ssl/certs")
NAMEN = [
    "ISRG_Root_X1.pem",
    "ISRG_Root_X2.pem",
    "USERTrust_RSA_Certification_Authority.pem",
    "USERTrust_ECC_Certification_Authority.pem",
]


def main() -> None:
    teile = ["// Automatisch erzeugt von tools/zertifikate.py - nicht von Hand aendern.",
             "// Wurzelzertifikate fuer die HTTPS-Pruefung (WiFiClientSecure::setCACert). SHA-256 der Zertifikate:"]
    pems = []
    for name in NAMEN:
        pem = (QUELLE / name).read_text(encoding="ascii").strip()
        der = ssl.PEM_cert_to_DER_cert(pem)
        teile.append(f"//   {name[:-4]}: {hashlib.sha256(der).hexdigest()}")
        pems.append(pem)
    teile += ["#pragma once", "", "static const char DORF_WURZELN[] =", '    R"PEM(' + "\n".join(pems) + "\n" + ')PEM";', ""]
    out = ROOT / "src" / "zertifikate.h"
    out.write_text("\n".join(teile), encoding="ascii")
    print(f"{out.relative_to(ROOT)}: {len(pems)} Zertifikate")


if __name__ == "__main__":
    main()
