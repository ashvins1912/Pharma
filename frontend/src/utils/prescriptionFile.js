const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2D];
const JPEG_SIGNATURE = [0xFF, 0xD8, 0xFF];
const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

const startsWith = (bytes, signature) =>
  signature.every((value, index) => bytes[index] === value);

export const normalizePrescriptionBlob = async (value, hintedContentType = '') => {
  const blob = value instanceof Blob ? value : new Blob([value]);

  if (!blob.size) {
    throw new Error('Prescription file is empty.');
  }

  const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const normalizedHint = String(hintedContentType || blob.type || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();

  let detectedType = null;

  if (startsWith(header, PDF_SIGNATURE)) {
    detectedType = 'application/pdf';
  } else if (startsWith(header, JPEG_SIGNATURE)) {
    detectedType = 'image/jpeg';
  } else if (startsWith(header, PNG_SIGNATURE)) {
    detectedType = 'image/png';
  } else if (
    header.length >= 12 &&
    startsWith(header, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(header.slice(8), [0x57, 0x45, 0x42, 0x50])
  ) {
    detectedType = 'image/webp';
  }

  const contentType = detectedType || normalizedHint;

  if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
    throw new Error('Unsupported prescription file type.');
  }

  return blob.type === contentType
    ? blob
    : new Blob([blob], { type: contentType });
};
