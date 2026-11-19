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
# „base“ quantisiert (57 MB): auf einem CPU-Kern etwa 2–4× schneller als Echtzeit, Deutsch brauchbar
RUN curl -fsSL -o /ggml-base-q5_1.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin \
    && echo "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898  /ggml-base-q5_1.bin" | sha256sum -c -

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
    && rm -rf /var/lib/apt/lists/* /usr/share/doc/* /usr/share/man/*
COPY --from=whisper /whisper-cli /usr/local/bin/whisper-cli
COPY --from=whisper /ggml-base-q5_1.bin /opt/whisper/ggml-base-q5_1.bin
COPY --from=whisper /pptx/pptx /usr/local/lib/python3.11/dist-packages/pptx
RUN useradd -u 1000 -m rechner && mkdir -p /arbeit && chown rechner:rechner /arbeit
COPY apps/rechenraum/runner.py /app/runner.py
ENV ARBEIT_DIR=/arbeit PORT=4100 PYTHONUNBUFFERED=1 WHISPER_MODELL=/opt/whisper/ggml-base-q5_1.bin
USER rechner
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:4100/gesundheit',timeout=3).status==200 else 1)"
CMD ["python3", "/app/runner.py"]
