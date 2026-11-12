# Tenant-isolated private image assets

Private inventory/medicine imagery is uploaded and served through backend authorization. The API stores an opaque asset reference; Cloudinary provider identifiers and URLs are never returned to the client.

## Endpoints
- `POST /api/private-images`: multipart `image`, `purpose=medicine-image`; requires authenticated `inventory.write`.
- `GET /api/private-images/:assetId/content`: owner or exact tenant+branch staff authorization; backend proxies authenticated Cloudinary bytes; private no-store cache headers.
- `DELETE /api/private-images/:assetId`: scoped access, checks medicine/request references, provider cleanup and soft-delete metadata.

## Configuration
Set `IMAGE_STORAGE_PROVIDER=cloudinary`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`; optional `IMAGE_MAX_BYTES` (5 MiB) and `IMAGE_MAX_PIXELS` (25 million). Private images use Cloudinary `authenticated` delivery and hashed tenant/branch folder segments. Public catalog upload `/api/upload/image` remains distinct for public images.

Prescription documents and customer request attachments stay in the existing owner-authorized GridFS flow. Never trust body/query tenant or branch identifiers for private asset ownership.

## Rollout
Deploy backend and gateway capability registry first. Client should store `assetId` in `imageAssetId` and render via the authenticated content route. Legacy `imageUrl` values are retained for compatibility; do not automatically reclassify public legacy URLs. Review Cloudinary folder access configuration and structured audit logs.
