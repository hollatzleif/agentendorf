# syntax=docker/dockerfile:1
# Rechenraum: pdflatex + Python zum Rechnen, ohne Netz und ohne Vault. Bauen aus dem Repo-Wurzelverzeichnis:
#   docker build -f apps/rechenraum/Dockerfile .
#
# E190: Dazu die Umwandlung fremder Dateien (/umwandeln in runner.py): ffmpeg (Audio/Video), whisper.cpp mit kleinem
# Modell (Sprachnachrichten → Text, nur CPU, ohne Netz), tesseract (Scans), rsvg-convert (SVG), heif-convert (iPhone-
# Fotos), catdoc (alte .doc/.ppt), xlrd (alte .xls), olefile (Outlook-.msg), Pillow (Bilder). Office/ODF, Mail, Archive
# und HTML liest runner.py mit der Standardbibliothek. Kein LibreOffice (≈ 500 MB) – Folien gibt es nur als Text.
# Zum ERZEUGEN von Dateien (Agenten legen sie mit rechenraum_ablegen ab): python-docx, openpyxl, XlsxWriter, python-pptx,
# odfpy, Pillow, matplotlib – Word, Excel, PowerPoint, OpenDocument, Bilder, Diagramme.
# E199 – feste Werkzeuge (dorfwerk.py über /werkzeug): pypdf (PDF bearbeiten), Ghostscript (PDF verkleinern), Graphviz
# (Diagramme), segno (QR-Codes), genanki (Anki-Pakete), DuckDB + pandas (Datenabfragen). Mermaid bräuchte Chromium – nicht drin.
# E212 – Handschrift (handschrift.py, nur NumPy + rsvg-convert) mit den Gewichten aus /opt/handschrift; E213 Formeln und
# Tabellen von Hand (handformel.py + hershey/glyphen.json, Hershey-Einstrichzeichen).
# E217: handbewegung.py schreibt jeden Strich mit einem Bewegungsmodell (Sigma-Lognormal) neu – nur NumPy.

# ---- whisper.cpp (Transkription) – feste Version, Modell mit Prüfsumme ------------------------------------------------
# Gebaut für x86-64 mit AVX2/FMA (jede Server-CPU seit 2013); ohne AVX2 wäre es ~10× langsamer. Fehlt AVX2 auf dem Server,
# meldet die Umwandlung „Transkription fehlgeschlagen“ – alles andere läuft weiter.
FROM debian:bookworm-slim AS whisper
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch v1.8.7 https://github.com/ggml-org/whisper.cpp /src \
    && cmake -S /src -B /bau -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF \
         -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON \
         -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DWHISPER_BUILD_EXAMPLES=ON \
    && cmake --build /bau -j"$(nproc)" --target whisper-cli \
    && install -m 755 /bau/bin/whisper-cli /whisper-cli
# python-pptx gibt es in Debian 12 nicht: reines Python, feste Version, ohne Abhängigkeiten (lxml, Pillow, XlsxWriter kommen aus apt)
RUN apt-get update && apt-get install -y --no-install-recommends python3-pip && rm -rf /var/lib/apt/lists/* \
    && pip3 install --no-cache-dir --break-system-packages --no-deps --target /pptx python-pptx==0.6.23
# E199: reine Python-Pakete (bzw. ein fertiges Wheel für Python 3.11) mit fester Version UND Prüfsumme, ohne Abhängigkeiten
# aus dem Netz nachzuziehen (PyYAML für genanki kommt aus apt). Debian 12 hat genanki, duckdb und aktuelles pypdf nicht.
RUN printf '%s\n' \
      'pypdf==7.1.1 --hash=sha256:04c5680d4b4cfa04ab505b09393fc949860c34a4dad6565284d11a2f5c3ce8b1' \
      'segno==1.6.6 --hash=sha256:28c7d081ed0cf935e0411293a465efd4d500704072cdb039778a2ab8736190c7' \
      'genanki==0.13.1 --hash=sha256:65b59434008588a1213b940474d1aca8cca83243af6fc0e26200b560efe4d9e3' \
      'chevron==0.14.0 --hash=sha256:fbf996a709f8da2e745ef763f482ce2d311aa817d287593a5b990d6d6e4f0443' \
      'cached-property==2.0.1 --hash=sha256:f617d70ab1100b7bcf6e42228f9ddcb78c676ffa167278d9f730d1c2fba69ccb' \
      'frozendict==2.5.1 --hash=sha256:b6e602e286b912beca1e12615f50eda6c74646b440c8cfde34221adee6c98c5e' \
      'duckdb==2.0.0 --hash=sha256:5a3601121c7cc50d0b70412995634682fafcb58a0156d5d663dfd0b3bbe30a33' \
      > /tmp/dorfwerk.txt \
    && pip3 install --no-cache-dir --break-system-packages --no-deps --only-binary=:all: --require-hashes \
         --target /dorfwerk -r /tmp/dorfwerk.txt \
    && rm -rf /dorfwerk/bin /tmp/dorfwerk.txt
# „base“ quantisiert (57 MB): auf einem CPU-Kern etwa 2–4× schneller als Echtzeit, Deutsch brauchbar
RUN curl -fsSL -o /ggml-base-q5_1.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin \
    && echo "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898  /ggml-base-q5_1.bin" | sha256sum -c -

# E198 – Bildbearbeitung (/bild in runner.py): onnxruntime (MIT, nur CPU, braucht nur numpy) und zwei kleine Modelle mit
# Prüfsumme – „Hintergrund entfernen“ (U²-Net u2netp, 4,6 MB, Apache-2.0, aus den rembg-Releases) und „Hochskalieren“
# (Real-ESRGAN general-x4v3, 4,8 MB, BSD-3-Clause, ONNX-Fassung von Qualcomm AI Hub). Ist eine Quelle nicht erreichbar, baut
# das Image trotzdem (der Runner meldet dann ehrlich „Modell fehlt“); eine falsche Prüfsumme bricht den Bau ab.
RUN pip3 install --no-cache-dir --break-system-packages --no-deps --target /ort onnxruntime==1.19.2 && mkdir /bild
RUN if curl -fsSL -o /bild/u2netp.onnx https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx; then \
      echo "309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8  /bild/u2netp.onnx" | sha256sum -c -; \
    else echo "WARNUNG: u2netp nicht geladen – Hintergrund entfernen fehlt in diesem Image"; rm -f /bild/u2netp.onnx; fi
RUN if curl -fsSL -o /tmp/esr.zip https://qaihub-public-assets.s3.us-west-2.amazonaws.com/qai-hub-models/models/real_esrgan_general_x4v3/releases/v0.67.0/real_esrgan_general_x4v3-onnx-float.zip; then \
      echo "4f3619c89eb0727ff9170b977578d160fa4d696680a0cac4c7f870b52973033b  /tmp/esr.zip" | sha256sum -c - \
      && python3 -m zipfile -e /tmp/esr.zip /tmp/esr \
      && cp /tmp/esr/real_esrgan_general_x4v3-onnx-float/real_esrgan_general_x4v3_onnx/real_esrgan_general_x4v3.onnx \
            /tmp/esr/real_esrgan_general_x4v3-onnx-float/real_esrgan_general_x4v3_onnx/real_esrgan_general_x4v3.data /bild/ \
      && echo "ca44c913c9669c5e656d25bc900da6856e828b98422c17f31ddec69d99b331a0  /bild/real_esrgan_general_x4v3.onnx" | sha256sum -c - \
      && echo "512d0ec9940c2e9d85d27f2952f12a0b77b7841dc22df4ce9f3ea458bc98f37f  /bild/real_esrgan_general_x4v3.data" | sha256sum -c -; \
    else echo "WARNUNG: Real-ESRGAN nicht geladen – Hochskalieren fehlt in diesem Image"; fi

# E212 Handschrift (handschrift.py): Gewichte des Graves-Modells aus X-rayLaser/pytorch-handwriting-synthesis-toolkit
# (MIT, © 2021 Evgenii Dolotov; trainiert auf IAM-OnDB) – fester Commit, Prüfsummen. Kein PyTorch: handschrift.py liest
# model.pt selbst (nur NumPy). Fehlt die Quelle, baut das Image trotzdem (Werkzeug meldet „Modell fehlt“).
RUN mkdir /handschrift && Q=https://raw.githubusercontent.com/X-rayLaser/pytorch-handwriting-synthesis-toolkit/899e9432dfe0998ba2ef31582d11c2d5f24a5185 \
    && if curl -fsSL -o /handschrift/model.pt "$Q/checkpoints/Epoch_56/model.pt" \
         && curl -fsSL -o /handschrift/meta.json "$Q/checkpoints/Epoch_56/meta.json" \
         && curl -fsSL -o /handschrift/LICENSE "$Q/LICENSE"; then \
      echo "e5eddd9f771ef1f0414909e61f173e88f293a35cb4c99cf359ac296552349e43  /handschrift/model.pt" | sha256sum -c - \
      && echo "00c383051895af5a091743652597dc4a9c456c70d07ec7ca51a96fcad6e6f70c  /handschrift/meta.json" | sha256sum -c - \
      && echo "f41b79c57cec88a12132c678006fec1844470a9232471d21371ad21d5a91087e  /handschrift/LICENSE" | sha256sum -c -; \
    else echo "WARNUNG: Handschrift-Modell nicht geladen – handschrift_schreiben fehlt in diesem Image"; rm -f /handschrift/*; fi

# ---- Rechenraum ---------------------------------------------------------------------------------------------------
FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      texlive-latex-base texlive-latex-recommended texlive-latex-extra texlive-pictures \
      texlive-fonts-recommended texlive-science lmodern cm-super \
      python3 python3-numpy python3-sympy python3-scipy python3-matplotlib \
      poppler-utils ca-certificates \
      python3-pil python3-xlrd python3-olefile catdoc librsvg2-bin libheif-examples ffmpeg \
      python3-docx python3-openpyxl python3-xlsxwriter python3-lxml python3-odf \
      tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng \
      graphviz ghostscript python3-pandas python3-yaml \
    && rm -rf /var/lib/apt/lists/* /usr/share/doc/* /usr/share/man/*
COPY --from=whisper /whisper-cli /usr/local/bin/whisper-cli
COPY --from=whisper /ggml-base-q5_1.bin /opt/whisper/ggml-base-q5_1.bin
COPY --from=whisper /pptx/pptx /usr/local/lib/python3.11/dist-packages/pptx
COPY --from=whisper /dorfwerk/ /usr/local/lib/python3.11/dist-packages/
COPY --from=whisper /ort/onnxruntime /usr/local/lib/python3.11/dist-packages/onnxruntime
COPY --from=whisper /bild /opt/bild
COPY --from=whisper /handschrift /opt/handschrift
RUN useradd -u 1000 -m rechner && mkdir -p /arbeit && chown rechner:rechner /arbeit
COPY apps/rechenraum/runner.py /app/runner.py
COPY apps/rechenraum/dorfwerk.py /app/dorfwerk.py
COPY apps/rechenraum/handschrift.py /app/handschrift.py
COPY apps/rechenraum/handformel.py /app/handformel.py
COPY apps/rechenraum/handbewegung.py /app/handbewegung.py
COPY apps/rechenraum/hershey/glyphen.json /app/hershey/glyphen.json
ENV ARBEIT_DIR=/arbeit PORT=4100 PYTHONUNBUFFERED=1 WHISPER_MODELL=/opt/whisper/ggml-base-q5_1.bin
USER rechner
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:4100/gesundheit',timeout=3).status==200 else 1)"
CMD ["python3", "/app/runner.py"]
