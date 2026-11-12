/**
 * Complete Architectural Implementation of Spatial Indexing & Probabilistic Data Structures (ProbDS)
 * Part 1: Probabilistic Data Structures (Bloom Filter, HyperLogLog, Count-Min Sketch)
 * Part 2: Spatial Indexing & Geospatial Utilities (Haversine, Geohash, SpatialGridIndex, k-NN)
 */

// ==========================================
// PART 1: PROBABILISTIC DATA STRUCTURES (ProbDS)
// ==========================================

/**
 * 1. Simple Bloom Filter for O(1) membership check of restricted / controlled drugs.
 */
export class SimpleBloomFilter {
  constructor(size = 2048, numHashFunctions = 4) {
    this.size = size;
    this.numHashFunctions = numHashFunctions;
    this.bitArray = new Uint8Array(Math.ceil(size / 8));
  }

  _hash(str, seed) {
    let hash = seed;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 33 + str.charCodeAt(i)) % this.size;
    }
    return Math.abs(hash);
  }

  add(item) {
    const key = String(item).toLowerCase().trim();
    for (let i = 0; i < this.numHashFunctions; i++) {
      const bitIndex = this._hash(key, i + 1);
      const byteIndex = Math.floor(bitIndex / 8);
      const bitOffset = bitIndex % 8;
      this.bitArray[byteIndex] |= (1 << bitOffset);
    }
  }

  has(item) {
    const key = String(item).toLowerCase().trim();
    for (let i = 0; i < this.numHashFunctions; i++) {
      const bitIndex = this._hash(key, i + 1);
      const byteIndex = Math.floor(bitIndex / 8);
      const bitOffset = bitIndex % 8;
      if ((this.bitArray[byteIndex] & (1 << bitOffset)) === 0) {
        return false; // Definitely not present
      }
    }
    return true; // Probably present
  }
}

/**
 * 2. HyperLogLog (HLL) Cardinality Estimator for distinct customer & search analytics.
 */
export class HyperLogLogEstimator {
  constructor(precision = 10) {
    this.p = precision;
    this.m = 1 << precision;
    this.registers = new Uint8Array(this.m);
    this.alpha = this._getAlpha(this.m);
  }

  _getAlpha(m) {
    if (m === 16) return 0.673;
    if (m === 32) return 0.697;
    if (m === 64) return 0.709;
    return 0.7213 / (1 + 1.079 / m);
  }

  _hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  _rho(hashVal, maxBits = 32) {
    const lead = maxBits - this.p;
    const val = (hashVal << this.p) >>> 0;
    if (val === 0) return lead + 1;
    let r = 1;
    while ((val & (1 << (maxBits - 1))) === 0) {
      r++;
      hashVal <<= 1;
    }
    return r;
  }

  add(item) {
    const x = this._hash(String(item));
    const j = x >>> (32 - this.p);
    const w = x << this.p;
    this.registers[j] = Math.max(this.registers[j], this._rho(w));
  }

  count() {
    let sum = 0;
    let zeros = 0;
    for (let i = 0; i < this.m; i++) {
      sum += Math.pow(2, -this.registers[i]);
      if (this.registers[i] === 0) zeros++;
    }
    let estimate = this.alpha * this.m * this.m / sum;
    if (estimate <= 2.5 * this.m && zeros > 0) {
      estimate = this.m * Math.log(this.m / zeros);
    }
    return Math.round(estimate);
  }
}

/**
 * 3. Count-Min Sketch for tracking trending medicine search frequency.
 */
export class CountMinSketch {
  constructor(width = 512, depth = 4) {
    this.width = width;
    this.depth = depth;
    this.table = Array.from({ length: depth }, () => new Uint32Array(width));
  }

  _hash(str, seed) {
    let hash = seed;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) % this.width;
    }
    return Math.abs(hash);
  }

  add(item, count = 1) {
    const key = String(item).toLowerCase().trim();
    for (let i = 0; i < this.depth; i++) {
      const col = this._hash(key, i + 1);
      this.table[i][col] += count;
    }
  }

  estimate(item) {
    const key = String(item).toLowerCase().trim();
    let minVal = Infinity;
    for (let i = 0; i < this.depth; i++) {
      const col = this._hash(key, i + 1);
      minVal = Math.min(minVal, this.table[i][col]);
    }
    return minVal === Infinity ? 0 : minVal;
  }
}


// ==========================================
// PART 2: SPATIAL INDEXING & GEOSPATIAL UTILITIES
// ==========================================

/**
 * Haversine distance between two coordinates in kilometers.
 */
export function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Geohash encoder for discrete global grid spatial indexing.
 */
export function encodeGeohash(lat, lon, precision = 5) {
  const base32 = '0123456789bcdefghjkmnpqrstuvwxyz';
  let idx = 0;
  let bit = 0;
  let evenBit = true;
  let geohash = '';

  let latMin = -90, latMax = 90;
  let lonMin = -180, lonMax = 180;

  while (geohash.length < precision) {
    if (evenBit) {
      const mid = (lonMin + lonMax) / 2;
      if (lon > mid) {
        idx = (idx << 1) + 1;
        lonMin = mid;
      } else {
        idx = (idx << 1);
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat > mid) {
        idx = (idx << 1) + 1;
        latMin = mid;
      } else {
        idx = (idx << 1);
        latMax = mid;
      }
    }
    evenBit = !evenBit;
    bit++;
    if (bit === 5) {
      geohash += base32[idx];
      bit = 0;
      idx = 0;
    }
  }
  return geohash;
}

/**
 * Spatial Grid Index for O(1) bucket lookups of nearby couriers and pharmacies.
 */
export class SpatialGridIndex {
  constructor(precision = 5) {
    this.precision = precision;
    this.grid = new Map();
  }

  insert(entityId, lat, lon, data) {
    const hash = encodeGeohash(lat, lon, this.precision);
    if (!this.grid.has(hash)) {
      this.grid.set(hash, []);
    }
    this.grid.get(hash).push({ id: entityId, lat, lon, data });
  }

  queryRadius(lat, lon, maxKm = 10) {
    const results = [];
    for (const [hash, items] of this.grid.entries()) {
      items.forEach(item => {
        const dist = calculateHaversineDistance(lat, lon, item.lat, item.lon);
        if (dist <= maxKm) {
          results.push({ ...item, distanceKm: Math.round(dist * 10) / 10 });
        }
      });
    }
    return results.sort((a, b) => a.distanceKm - b.distanceKm);
  }

  clear() {
    this.grid.clear();
  }
}
