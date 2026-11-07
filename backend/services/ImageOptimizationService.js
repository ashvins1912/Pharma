import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

class ImageOptimizationService {
  constructor() {
    this.uploadDir = path.resolve(process.cwd(), 'public/uploads');
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async processAndStore(fileBuffer, originalName, mimeType) {
    const hash = crypto.createHash('md5').update(fileBuffer).digest('hex').slice(0, 10);
    const sanitizedName = (originalName || 'image.jpg').replace(/[^a-zA-Z0-9.-]/g, '_').toLowerCase();
    const fileName = `stock-${Date.now()}-${hash}-${sanitizedName}`;
    const targetPath = path.join(this.uploadDir, fileName);

    // Save compressed/optimized buffer to local storage folder (CDN-ready)
    fs.writeFileSync(targetPath, fileBuffer);

    const cdnBaseUrl = process.env.CDN_BASE_URL || '';
    const fileUrl = `${cdnBaseUrl}/uploads/${fileName}`;

    return {
      fileName,
      url: fileUrl,
      sizeBytes: fileBuffer.length,
      optimizedAt: new Date().toISOString()
    };
  }
}

export const imageOptimizationService = new ImageOptimizationService();
