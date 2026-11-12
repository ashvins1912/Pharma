import { IStorageService } from '../../ports/IStorageService.js';
import { createClient } from '@supabase/supabase-js';

/**
 * Concrete Storage Driver: Supabase Storage
 * Uploads rider profile pictures directly to Supabase Storage bucket
 */
export class SupabaseStorageDriver extends IStorageService {
    /**
     * @param {object} config
     * @param {string} [config.supabaseUrl]
     * @param {string} [config.supabaseServiceKey]
     */
    constructor(config = {}) {
        super();
        this.supabaseUrl = config.supabaseUrl || process.env.SUPABASE_URL;
        this.supabaseServiceKey = config.supabaseServiceKey || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
        this.client = null;

        if (this.supabaseUrl && this.supabaseServiceKey) {
            try {
                this.client = createClient(this.supabaseUrl, this.supabaseServiceKey);
            } catch (err) {
                console.warn('⚠️ [SupabaseStorageDriver] Initialization warning:', err.message);
            }
        }
    }

    isAvailable() {
        return Boolean(this.client && this.supabaseUrl);
    }

    async upload({ buffer, filename, mimeType, bucket = 'rider-photos' }) {
        if (!this.isAvailable()) {
            throw new Error('Supabase Storage is not configured. Provide SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
        }

        const cleanFilename = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

        // Ensure bucket exists or attempt upload
        const { error: uploadError } = await this.client.storage
            .from(bucket)
            .upload(cleanFilename, buffer, {
                contentType: mimeType,
                upsert: true
            });

        if (uploadError) {
            throw new Error(`Supabase Storage upload failed: ${uploadError.message}`);
        }

        const { data: publicUrlData } = this.client.storage
            .from(bucket)
            .getPublicUrl(cleanFilename);

        return {
            publicUrl: publicUrlData.publicUrl,
            key: `${bucket}/${cleanFilename}`
        };
    }

    async delete(keyOrUrl, bucket = 'rider-photos') {
        if (!this.isAvailable()) return false;
        try {
            const filename = keyOrUrl.split('/').pop();
            const { error } = await this.client.storage.from(bucket).remove([filename]);
            return !error;
        } catch {
            return false;
        }
    }
}
