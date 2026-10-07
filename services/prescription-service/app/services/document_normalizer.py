"""Normalize uploaded prescription documents to a canonical PDF representation."""
from __future__ import annotations

import io
from dataclasses import dataclass

import fitz
import numpy as np
import cv2


SUPPORTED_IMAGE_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/bmp",
    "image/tiff",
    "image/x-ms-bmp",
}


@dataclass(frozen=True)
class NormalizedDocument:
    data: bytes
    filename: str
    content_type: str
    original_content_type: str
    original_filename: str


def _looks_like_pdf(data: bytes) -> bool:
    return data[:5] == b"%PDF-"


def _image_to_pdf(data: bytes, content_type: str) -> bytes:
    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Unable to decode the uploaded image.")

    height, width = image.shape[:2]
    if width <= 0 or height <= 0:
        raise ValueError("Uploaded image has invalid dimensions.")

    # Encode as PNG first so PDF creation is independent of the source image format.
    ok, encoded = cv2.imencode(".png", image)
    if not ok:
        raise ValueError("Unable to convert the uploaded image to PNG.")

    doc = fitz.open()
    try:
        # Keep the physical page close to the source aspect ratio.
        # 150 DPI gives OCR enough detail without producing unnecessarily huge PDFs.
        scale = 72.0 / 150.0
        page_width = min(max(width * scale, 72.0), 1440.0)
        page_height = min(max(height * scale, 72.0), 1440.0)

        # If one dimension was capped, preserve aspect ratio.
        ratio = min(1440.0 / page_width, 1440.0 / page_height, 1.0)
        page_width *= ratio
        page_height *= ratio

        page = doc.new_page(width=page_width, height=page_height)
        page.insert_image(
            fitz.Rect(0, 0, page_width, page_height),
            stream=encoded.tobytes(),
        )
        return doc.tobytes(garbage=4, deflate=True)
    finally:
        doc.close()


def normalize_prescription_document(
    data: bytes,
    filename: str | None,
    content_type: str | None,
    max_pages: int = 15,
) -> NormalizedDocument:
    if not data:
        raise ValueError("file is required")

    original_type = (content_type or "").split(";", 1)[0].strip().lower()
    original_name = filename or "prescription"

    if _looks_like_pdf(data) or original_type == "application/pdf":
        if not _looks_like_pdf(data):
            raise ValueError("Uploaded file is not a valid PDF.")

        try:
            pdf = fitz.open(stream=data, filetype="pdf")
            try:
                if pdf.page_count < 1:
                    raise ValueError("PDF has no pages.")
                if pdf.page_count > max_pages:
                    raise ValueError(f"PDF cannot contain more than {max_pages} pages.")
            finally:
                pdf.close()
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("Uploaded PDF could not be opened.") from exc

        return NormalizedDocument(
            data=data,
            filename=f"{original_name.rsplit('.', 1)[0]}.pdf",
            content_type="application/pdf",
            original_content_type=original_type or "application/pdf",
            original_filename=original_name,
        )

    if not original_type.startswith("image/"):
        raise ValueError("Prescription must be a PDF or image.")

    try:
        pdf_bytes = _image_to_pdf(data, original_type)
    except Exception as exc:
        if isinstance(exc, ValueError):
            raise
        raise ValueError("Unable to convert the uploaded image to PDF.") from exc

    return NormalizedDocument(
        data=pdf_bytes,
        filename=f"{original_name.rsplit('.', 1)[0]}.pdf",
        content_type="application/pdf",
        original_content_type=original_type,
        original_filename=original_name,
    )
