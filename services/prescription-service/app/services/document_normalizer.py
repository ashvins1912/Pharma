"""Normalize uploaded prescription documents to a canonical PDF representation.

Mobile photos are normalized before OCR so camera orientation, HEIC/HEIF, and
very large camera images do not leak format-specific behavior into the rest of
the prescription pipeline.
"""
from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO

import fitz
from PIL import Image, ImageOps, ImageFile

try:
    from pillow_heif import register_heif_opener

    register_heif_opener()
except ImportError:
    # HEIC/HEIF uploads will return a clear validation error if the optional
    # codec is unavailable. The dependency is included in requirements.txt.
    pass


ImageFile.LOAD_TRUNCATED_IMAGES = False

# Prevent decompression-bomb / pathological camera images from consuming the
# Render instance's memory. Normal phone photos are far below this limit.
# Conservative limits keep peak Pillow/OpenCV/OCR memory low on small Render instances.
# 24 MP is enough for essentially all phone prescription photos while blocking
# pathological camera images from allocating hundreds of MB during decoding.
MAX_IMAGE_PIXELS = 24_000_000
# 2400px is enough detail for prescription OCR while substantially reducing RAM.
MAX_IMAGE_DIMENSION = 2400
# Keep the generated PDF compact; the raster image is the actual OCR payload.
PDF_MAX_DIMENSION = 1200
# Strong JPEG compression gives much smaller encrypted documents while retaining
# readable medicine names, dosage and handwritten text.
JPEG_QUALITY = 72


@dataclass(frozen=True)
class NormalizedDocument:
    data: bytes
    filename: str
    content_type: str
    original_content_type: str
    original_filename: str


def _looks_like_pdf(data: bytes) -> bool:
    return data[:5] == b"%PDF-"


def _open_mobile_image(data: bytes) -> Image.Image:
    try:
        image = Image.open(BytesIO(data))
        image.verify()
    except Exception as exc:
        raise ValueError(
            "Unable to decode the uploaded image. Please upload a clear JPG, PNG, WebP, HEIC/HEIF, or PDF."
        ) from exc

    try:
        image = Image.open(BytesIO(data))
        image.load()
    except Exception as exc:
        raise ValueError("Uploaded image could not be read completely.") from exc

    width, height = image.size
    if width <= 0 or height <= 0:
        raise ValueError("Uploaded image has invalid dimensions.")
    if width * height > MAX_IMAGE_PIXELS:
        raise ValueError(
            f"Image is too large to process safely. Maximum is {MAX_IMAGE_PIXELS:,} pixels."
        )

    # Mobile cameras commonly store the phone orientation in EXIF rather than
    # physically rotating pixels. Transpose makes OCR and the final PDF match
    # what the user sees in the gallery.
    image = ImageOps.exif_transpose(image)

    # Flatten transparency against white so PNG/WebP/GIF images render cleanly.
    if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, "white")
        background.paste(rgba, mask=rgba.getchannel("A"))
        image = background
    else:
        image = image.convert("RGB")

    # Downscale only when needed. This controls OCR/PDF memory without making
    # ordinary mobile photos unnecessarily blurry.
    if max(image.size) > MAX_IMAGE_DIMENSION:
        image.thumbnail((MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION), Image.Resampling.LANCZOS)

    return image


def _image_to_pdf(data: bytes) -> bytes:
    image = _open_mobile_image(data)

    # JPEG is substantially smaller than PNG for camera photos. Quality 72 is an
    # intentional memory/storage optimization while retaining OCR-readable text. PyMuPDF embeds it directly.
    image_buffer = BytesIO()
    image.save(image_buffer, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    jpeg_bytes = image_buffer.getvalue()

    width, height = image.size
    scale = 72.0 / 150.0
    page_width = max(width * scale, 72.0)
    page_height = max(height * scale, 72.0)

    if max(page_width, page_height) > PDF_MAX_DIMENSION:
        factor = PDF_MAX_DIMENSION / max(page_width, page_height)
        page_width *= factor
        page_height *= factor

    doc = fitz.open()
    try:
        page = doc.new_page(width=page_width, height=page_height)
        page.insert_image(
            fitz.Rect(0, 0, page_width, page_height),
            stream=jpeg_bytes,
        )
        return doc.tobytes(garbage=4, deflate=True, clean=True)
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
        pdf_bytes = _image_to_pdf(data)
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError(
            "Unable to convert the uploaded image to PDF. Please upload a clearer photo."
        ) from exc

    return NormalizedDocument(
        data=pdf_bytes,
        filename=f"{original_name.rsplit('.', 1)[0]}.pdf",
        content_type="application/pdf",
        original_content_type=original_type,
        original_filename=original_name,
    )
