# syntax=docker/dockerfile:1
# Rechenraum: pdflatex + Python zum Rechnen, ohne Netz und ohne Vault. Bauen aus dem Repo-Wurzelverzeichnis:
#   docker build -f apps/rechenraum/Dockerfile .
FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      texlive-latex-base texlive-latex-recommended texlive-latex-extra texlive-pictures \
      texlive-fonts-recommended texlive-science lmodern cm-super \
      python3 python3-numpy python3-sympy python3-scipy python3-matplotlib \
      poppler-utils ca-certificates \
    && rm -rf /var/lib/apt/lists/* /usr/share/doc/* /usr/share/man/*
RUN useradd -u 1000 -m rechner && mkdir -p /arbeit && chown rechner:rechner /arbeit
COPY apps/rechenraum/runner.py /app/runner.py
ENV ARBEIT_DIR=/arbeit PORT=4100 PYTHONUNBUFFERED=1
USER rechner
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:4100/gesundheit',timeout=3).status==200 else 1)"
CMD ["python3", "/app/runner.py"]
