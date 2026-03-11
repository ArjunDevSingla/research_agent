import logging
import re
import io
from typing import Optional

import httpx
import fitz

logger = logging.getLogger(__name__)

TARGET_SECTIONS = {
    "introduction": [
        r"^\d*\.?\s*introduction",
        r"^1\.\s*introduction",
    ],
    "results": [
        r"^\d+\.?\s*results",
        r"^\d+\.?\s*experimental results",
        r"^\d+\.?\s*experiments",
        r"^\d+\.?\s*evaluation",
    ],
    "discussion": [
        r"^\d*\.?\s*discussion",
        r"^\d*\.?\s*analysis",
    ],
    "conclusion": [
        r"^\d*\.?\s*conclusion",
        r"^\d*\.?\s*conclusions",
        r"^\d*\.?\s*concluding remarks",
        r"^\d*\.?\s*summary and conclusion",
    ],
    "limitations": [
        r"^\d*\.?\s*limitation",
        r"^\d*\.?\s*limitations",
        r"^\d*\.?\s*limitations and future",
        r"^\d*\.?\s*broader impact",
    ]
}

# How many characters to keep per section
# Enough context without overloading the LLM prompt
MAX_SECTION_CHARS = 1500

# Download Pdf
def download_pdf(pdf_url: str) -> Optional[bytes]:
    try:
        pdf_url = pdf_url.replace("http://", "https://")
        if "/abs/" in pdf_url:
            pdf_url = pdf_url.replace("/abs/", "/pdf/")

        logger.info(f"Downloading PDF: {pdf_url}")

        with httpx.Client(timeout=60, follow_redirects=True) as client:
            resp = client.get(pdf_url, headers={
                "User-Agent": "PaperSwarm/1.0 (Research Tool)"
            })
            resp.raise_for_status()

            content_type = resp.headers.get("content-type", "")
            if "pdf" not in content_type and not resp.content[:4] == b"%PDF":
                logger.warning(f"Response is not a PDF: {content_type}")
                return None
            
            logger.info(f"Downloaded {len(resp.content) / 1024:.1f} KB")
            return resp.content
        
    except httpx.TimeoutException:
        logger.warning(f"PDF download timed out: {pdf_url}")
        return None
    except Exception as e:
        logger.warning(f"PDF download failed: {e}")
        return None
    
def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        text = ""

        for page in doc:
            text += page.get_text("text")
            text += "\n"

        doc.close()
        return text
    
    except Exception as e:
        logger.warning(f"PDF text extraction failed: {e}")
        return ""
    
def extract_sections(text: str) -> dict:
    lines = text.split("\n")
    sections = {k: "" for k in TARGET_SECTIONS}

    current_section = None
    current_text = []

    def save_current():
        if current_section and current_text:
            content = " ".join(current_text).strip()
            if not sections[current_section]:
                sections[current_section] = content[:MAX_SECTION_CHARS]

    for line in lines:
        line_stripped = line.strip()
        if not line_stripped:
            continue

        matched_section = _match_section_header(line_stripped)

        if matched_section:
            save_current()
            current_section = matched_section
            current_text = []
        elif current_section:
            if len(" ".join(current_text)) < MAX_SECTION_CHARS:
                current_text.append(line_stripped)

    save_current()
    return sections

def _match_section_header(line: str) -> Optional[str]:
    line_lower = line.lower().strip()

    if len(line_lower) > 80:
        return None
    
    for section_name, patterns in TARGET_SECTIONS.items():
        for pattern in patterns:
            if re.match(pattern, line_lower):
                return section_name
            

def extract_tail_fallback(text: str) -> dict:
    if not text:
        return {k: "" for k in TARGET_SECTIONS}
    
    tail_start = int(len(text) * 0.70)
    tail_text = text[tail_start:tail_start + MAX_SECTION_CHARS * 3]

    logger.info("Using tail fallback for section extraction")

    return {
        "introduction": text[:MAX_SECTION_CHARS],   # beginning = intro
        "results": "",
        "discussion": "",
        "conclusion": tail_text[:MAX_SECTION_CHARS],
        "limitations": ""
    }

def fetch_paper_sections(pdf_url: str) -> dict:
    empty = {k: "" for k in TARGET_SECTIONS}

    if not pdf_url:
        logger.warning("No PDF URL provided — skipping section extraction")
        return empty
    
    pdf_bytes = download_pdf(pdf_url)
    if not pdf_bytes:
        logger.warning("PDF download failed — worker will use abstract only")
        return empty
    
    full_text = extract_text_from_pdf(pdf_bytes)
    if not full_text:
        logger.warning("PDF text extraction failed — worker will use abstract only")
        return empty
    
    logger.info(f"Extracted {len(full_text)} chars from PDF")

    sections = extract_sections(full_text)

    found = [k for k, v in sections.items() if v]
    logger.info(f"Sections found: {found if found else 'none'}")

    if len(found) < 2:
        sections = extract_tail_fallback(full_text)

    return sections