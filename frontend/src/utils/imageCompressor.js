/**
 * High-Performance Client-Side Image & Document Compressor
 * Utilizes HTML5 Canvas & WebP/JPEG encoding to compress high-resolution mobile photos (5-15MB)
 * down to crisp ~150-300KB payloads before uploading over the wire.
 */

export async function compressImageFile(file, options = {}) {
    const {
        maxWidth = 1600,
        maxHeight = 1600,
        quality = 0.8,
        outputType = 'image/webp'
    } = options;

    if (!file) return null;

    // If file is already small (e.g. < 100KB) or PDF document, return as is
    if (file.type === 'application/pdf') {
        return {
            file,
            dataUrl: await readFileAsDataUrl(file),
            originalSize: file.size,
            compressedSize: file.size,
            reductionRatio: '0%'
        };
    }

    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                let { width, height } = img;

                // Scale down dimensions while maintaining aspect ratio
                if (width > maxWidth || height > maxHeight) {
                    if (width > height) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    } else {
                        width = Math.round((width * maxHeight) / height);
                        height = maxHeight;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    return resolve({
                        file,
                        dataUrl: event.target.result,
                        originalSize: file.size,
                        compressedSize: file.size,
                        reductionRatio: '0%'
                    });
                }

                // Render image onto canvas
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);

                // Export compressed image data URL
                let dataUrl = canvas.toDataURL(outputType, quality);
                
                // Fallback to image/jpeg if browser doesn't support WebP export
                if (!dataUrl.startsWith(`data:${outputType}`)) {
                    dataUrl = canvas.toDataURL('image/jpeg', quality);
                }

                // Convert dataUrl to compressed File
                const byteString = atob(dataUrl.split(',')[1]);
                const mimeString = dataUrl.split(',')[0].split(':')[1].split(';')[0];
                const ab = new ArrayBuffer(byteString.length);
                const ia = new Uint8Array(ab);
                for (let i = 0; i < byteString.length; i++) {
                    ia[i] = byteString.charCodeAt(i);
                }

                const blob = new Blob([ab], { type: mimeString });
                const fileName = file.name ? file.name.replace(/\.[^/.]+$/, '.webp') : 'compressed_upload.webp';
                const compressedFile = new File([blob], fileName, { type: mimeString, lastModified: Date.now() });

                const originalSize = file.size;
                const compressedSize = compressedFile.size;
                const reduction = originalSize > 0 ? Math.round(((originalSize - compressedSize) / originalSize) * 100) : 0;

                console.info(`⚡ [ImageCompressor] Compressed "${file.name}" from ${(originalSize / 1024 / 1024).toFixed(2)} MB to ${(compressedSize / 1024).toFixed(1)} KB (${reduction}% reduction)`);

                resolve({
                    file: compressedFile,
                    dataUrl,
                    originalSize,
                    compressedSize,
                    reductionRatio: `${reduction}%`
                });
            };

            img.onerror = (err) => {
                console.warn('[ImageCompressor] Image load error:', err);
                resolve({
                    file,
                    dataUrl: event.target.result,
                    originalSize: file.size,
                    compressedSize: file.size,
                    reductionRatio: '0%'
                });
            };

            img.src = event.target.result;
        };

        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(file);
    });
}

function readFileAsDataUrl(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.readAsDataURL(file);
    });
}
