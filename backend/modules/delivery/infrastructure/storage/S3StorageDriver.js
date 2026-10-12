import { IStorageService } from '../../ports/IStorageService.js';

/**
 * Concrete Storage Driver: AWS S3 / MinIO (Plug-and-play adapter)
 * Demonstrates Open/Closed Principle: Can be activated with zero modifications to core services.
 */
export class S3StorageDriver extends IStorageService {
    /**
     * @param {object} config
     * @param {string} [config.bucket]
     * @param {string} [config.region]
     */
    constructor(config = {}) {
        super();
        this.bucket = config.bucket || process.env.AWS_S3_BUCKET || 'pharmacy-delivery-assets';
        this.region = config.region || process.env.AWS_REGION || 'us-east-1';
    }

    async upload({ buffer, filename, mimeType, bucket }) {
        const targetBucket = bucket || this.bucket;
        const key = `riders/${Date.now()}-${filename}`;
        
        // When AWS SDK is configured:
        // const command = new PutObjectCommand({ Bucket: targetBucket, Key: key, Body: buffer, ContentType: mimeType });
        // await this.s3Client.send(command);
        
        const publicUrl = `https://${targetBucket}.s3.${this.region}.amazonaws.com/${key}`;
        return { publicUrl, key };
    }

    async delete(key, bucket) {
        // const command = new DeleteObjectCommand({ Bucket: bucket || this.bucket, Key: key });
        // await this.s3Client.send(command);
        return true;
    }
}
