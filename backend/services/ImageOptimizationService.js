import crypto from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import sharp from 'sharp';

const ALLOWED_FORMATS = new Set(['jpeg', 'jpg', 'png', 'webp', 'avif', 'gif']);
const MAX_IMAGE_BYTES = Number(process.env.IMAGE_MAX_BYTES || 5 * 1024 * 1024);
const MAX_IMAGE_PIXELS = Number(process.env.IMAGE_MAX_PIXELS || 25_000_000);

class ImageOptimizationService {
  constructor() {
    this.provider = String(process.env.IMAGE_STORAGE_PROVIDER || 'local').toLowerCase();
    this.cloudinaryConfigured = Boolean(
      process.env.CLOUDINARY_CLOUD_NAME
      && process.env.CLOUDINARY_API_KEY
      && process.env.CLOUDINARY_API_SECRET
    );

    if (this.provider === 'cloudinary' && !this.cloudinaryConfigured) {
      throw new Error('Cloudinary image storage is selected but credentials are incomplete.');
    }

    if (this.cloudinaryConfigured) {
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
        secure: true
      });
    }
  }

  async processAndStore(fileBuffer, originalName, mimeType) {
    if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
      throw new Error('Image upload must contain a non-empty file buffer.');
    }
    if (fileBuffer.length > MAX_IMAGE_BYTES) {
      throw new Error('Image exceeds the configured upload size limit.');
    }
    if (!String(mimeType || '').toLowerCase().startsWith('image/')) {
      throw new Error('Only image uploads are supported.');
    }

    let metadata;
    let optimizedBuffer;
    try {
      const image = sharp(fileBuffer, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' });
      metadata = await image.metadata();
      if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format.toLowerCase())) {
        throw new Error('Unsupported image format.');
      }
      optimizedBuffer = await image
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80, effort: 4 })
        .toBuffer();
    } catch (error) {
      throw new Error(error.message === 'Unsupported image format.'
        ? error.message
        : 'Invalid or unreadable image file.');
    }

    const hash = crypto.createHash('sha256').update(optimizedBuffer).digest('hex').slice(0, 24);
    const safeBaseName = String(originalName || 'image')
      .replace(/\\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .toLowerCase()
      .slice(0, 48) || 'image';
    const publicId = `${safeBaseName}-${hash}`;
    const folder = String(process.env.CLOUDINARY_UPLOAD_FOLDER || 'pharma/catalog')
      .split('/')
      .map(part => part.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64))
      .filter(Boolean)
      .join('/');

    if (this.provider === 'cloudinary') {
      const uploaded = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({
          folder,
          public_id: publicId,
          resource_type: 'image',
          overwrite: true,
          format: 'webp',
          tags: ['pharma-catalog']
        }, (error, result) => error ? reject(error) : resolve(result));
        stream.end(optimizedBuffer);
      });

      const optimizedUrl = cloudinary.url(uploaded.public_id, {
        secure: true,
        resource_type: 'image',
        type: 'upload',
        transformation: [{ fetch_format: 'auto', quality: 'auto', width: 1200, height: 1200, crop: 'limit' }]
      });

      return {
        provider: 'cloudinary',
        fileName: uploaded.public_id,
        publicId: uploaded.public_id,
        url: optimizedUrl,
        secureUrl: uploaded.secure_url,
        format: uploaded.format,
        width: uploaded.width,
        height: uploaded.height,
        sizeBytes: uploaded.bytes,
        originalSizeBytes: fileBuffer.length,
        optimizedAt: new Date().toISOString()
      };
    }

    if (process.env.NODE_ENV === 'production') {
      throw new Error('Production image uploads require IMAGE_STORAGE_PROVIDER=cloudinary.');
    }
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const uploadDir = path.resolve(process.cwd(), 'public/uploads');
    await fs.mkdir(uploadDir, { recursive: true });
    const fileName = `stock-${Date.now()}-${hash}.webp`;
    await fs.writeFile(path.join(uploadDir, fileName), optimizedBuffer);
    const baseUrl = String(process.env.CDN_BASE_URL || '').replace(/\\/$/, '');
    return {
      provider: 'local',
      fileName,
      url: `${baseUrl}/uploads/${fileName}`,
      format: 'webp',
      width: metadata.width,
      height: metadata.height,
      sizeBytes: optimizedBuffer.length,
      originalSizeBytes: fileBuffer.length,
      optimizedAt: new Date().toISOString()
    };
  }
}

export const imageOptimizationService = new ImageOptimizationService();
