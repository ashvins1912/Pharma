/**
 * Abstract Port: IStorageService (Strategy Pattern)
 * Defines file upload and asset storage abstraction.
 * Enables zero-code switching between Supabase Storage, AWS S3, Cloudflare R2, or local disk.
 */
export class IStorageService {
    /**
     * Upload a file buffer or stream
     * @param {object} params
     * @param {Buffer} params.buffer - File buffer
     * @param {string} params.filename - Desired filename / path
     * @param {string} params.mimeType - File content type (e.g. image/jpeg, image/png)
     * @param {string} [params.bucket] - Storage bucket name
     * @returns {Promise<{ publicUrl: string, key: string }>}
     */
    async upload({ buffer, filename, mimeType, bucket = 'rider-photos' }) {
        throw new Error('Method IStorageService.upload() must be implemented.');
    }

    /**
     * Delete an existing file
     * @param {string} keyOrUrl
     * @param {string} [bucket]
     * @returns {Promise<boolean>}
     */
    async delete(keyOrUrl, bucket = 'rider-photos') {
        throw new Error('Method IStorageService.delete() must be implemented.');
    }
}
