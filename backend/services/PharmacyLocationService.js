import { Quadtree, BoundingBox, QuadtreePoint } from './Quadtree.js';

class PharmacyLocationService {
  constructor() {
    const worldBoundary = new BoundingBox(-90, -180, 90, 180);
    this.quadtree = new Quadtree(worldBoundary, 4);
    this.isIndexed = false;
    this.spatialCache = new Map(); // R-Index spatial query cache
    this.cacheTtlMs = 5 * 60 * 1000; // 5 minutes TTL
  }

  buildIndex(pharmacies) {
    const worldBoundary = new BoundingBox(-90, -180, 90, 180);
    this.quadtree = new Quadtree(worldBoundary, 4);
    this.spatialCache.clear(); // Clear R-Index cache on rebuild

    pharmacies.forEach(pharmacy => {
      const coords = pharmacy.geoLocation?.coordinates;
      if (Array.isArray(coords) && coords.length === 2) {
        const lon = Number(coords[0]);
        const lat = Number(coords[1]);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          this.quadtree.insert(new QuadtreePoint(lat, lon, pharmacy));
        }
      }
    });
    this.isIndexed = true;
  }

  findNearby(lat, lon, radiusKm = 50) {
    if (!this.isIndexed) {
      return [];
    }

    // Quantize coordinates to 2 decimal places (~1.1km cell resolution) for R-Index cache hit
    const qLat = Number(lat).toFixed(2);
    const qLon = Number(lon).toFixed(2);
    const cacheKey = `spatial:${qLat}:${qLon}:${radiusKm}`;

    const cached = this.spatialCache.get(cacheKey);
    const now = Date.now();
    if (cached && (now - cached.timestamp < this.cacheTtlMs)) {
      return cached.results;
    }

    const results = this.quadtree.queryRadius(lat, lon, radiusKm);

    // Update R-Index Spatial Cache
    this.spatialCache.set(cacheKey, {
      results,
      timestamp: now
    });

    return results;
  }
}

export const pharmacyLocationService = new PharmacyLocationService();
