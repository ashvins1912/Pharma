import { IStorageService } from '../../ports/IStorageService.js';
import { randomUUID } from 'node:crypto';

/**
 * Concrete Storage Driver: Local/Memory Storage Driver
 * Provides reliable, instantaneous image hosting (Data URL / memory buffer)
 * used as offline fallback and during local development.
 */
export class LocalStorageDriver extends IStorageService {
    constructor() {
        super();
        this.memoryStore = new Map();
    }

    async upload({ buffer, filename, mimeType, bucket = 'rider-photos' }) {
        const fileId = randomUUID();
        const base64Data = buffer.toString('base64');
        const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${base64Data}`;
        const key = `${bucket}/${fileId}-${filename}`;

        this.memoryStore.set(key, {
            buffer,
            mimeType,
            filename,
            uploadedAt: new Date()
        });

        return {
            publicUrl: dataUrl,
            key
        };
    }

    async delete(keyOrUrl, bucket = 'rider-photos') {
        return this.memoryStore.delete(keyOrUrl);
    }
}
