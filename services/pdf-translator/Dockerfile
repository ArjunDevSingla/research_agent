FROM python:3.11-slim

# System deps:
#   tesseract-ocr-all  — OCR engine + all language packs (image text detection)
#   fonts-noto*        — Unicode fonts for re-inserting translated text (Hindi, Arabic, CJK, etc.)
#   libmupdf-dev       — needed by PyMuPDF on some platforms
RUN apt-get update && apt-get install -y --no-install-recommends \
        tesseract-ocr \
        tesseract-ocr-all \
        fonts-noto \
        fonts-noto-cjk \
        fonts-noto-extra \
        libmupdf-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

CMD ["python", "main.py"]
