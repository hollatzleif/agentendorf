#!/usr/bin/env python3
"""Baut eine winzige Test-Erweiterung als VSIX (E205) – nur Standardbibliothek, kein Netz.
Aufruf: test-vsix.py <ziel.vsix>   (oder ohne Ziel: schreibt auf die Standardausgabe)
Die Erweiterung „dorf-test.rauchtest“ 0.0.1 trägt nur einen Befehl bei und führt keinen Code aus."""
import io
import json
import sys
import zipfile

PAKET = {
    "name": "rauchtest",
    "publisher": "dorf-test",
    "displayName": "Dorf Rauchtest",
    "description": "Leere Erweiterung für den Rauchtest des Codehauses.",
    "version": "0.0.1",
    "engines": {"vscode": "^1.80.0"},
    "categories": ["Other"],
    "contributes": {"commands": [{"command": "dorfTest.nichts", "title": "Dorf: nichts tun"}]},
}
MANIFEST = """<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="rauchtest" Version="0.0.1" Publisher="dorf-test" />
    <DisplayName>Dorf Rauchtest</DisplayName>
    <Description xml:space="preserve">Leere Erweiterung für den Rauchtest des Codehauses.</Description>
    <Categories>Other</Categories>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.80.0" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
  </Assets>
</PackageManifest>
"""
TYPEN = """<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension=".json" ContentType="application/json" /><Default Extension=".vsixmanifest" ContentType="text/xml" /></Types>
"""

puffer = io.BytesIO()
with zipfile.ZipFile(puffer, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("extension.vsixmanifest", MANIFEST)
    z.writestr("[Content_Types].xml", TYPEN)
    z.writestr("extension/package.json", json.dumps(PAKET, indent=2))
if len(sys.argv) > 1:
    with open(sys.argv[1], "wb") as f:
        f.write(puffer.getvalue())
else:
    sys.stdout.buffer.write(puffer.getvalue())
