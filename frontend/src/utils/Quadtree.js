/**
 * Quadtree Spatial Indexing Data Structure for Pharmacy Location Service
 * Optimizes searching for nearby pharmacies based on geographic coordinate proximity (lat, lon)
 * with O(log N) bounding box and radius queries.
 */

import { calculateHaversineDistance } from './spatialProbUtils';

export class BoundingBox {
  constructor(minLat, minLon, maxLat, maxLon) {
    this.minLat = minLat;
    this.minLon = minLon;
    this.maxLat = maxLat;
    this.maxLon = maxLon;
  }

  contains(lat, lon) {
    return (
      lat >= this.minLat &&
      lat <= this.maxLat &&
      lon >= this.minLon &&
      lon <= this.maxLon
    );
  }

  intersects(range) {
    return !(
      range.minLat > this.maxLat ||
      range.maxLat < this.minLat ||
      range.minLon > this.maxLon ||
      range.maxLon < this.minLon
    );
  }
}

export class QuadtreePoint {
  constructor(lat, lon, data) {
    this.lat = lat;
    this.lon = lon;
    this.data = data;
  }
}

export class Quadtree {
  constructor(boundary, capacity = 4) {
    if (!(boundary instanceof BoundingBox)) {
      throw new Error('Quadtree boundary must be an instance of BoundingBox.');
    }
    this.boundary = boundary;
    this.capacity = capacity;
    this.points = [];
    this.divided = false;
  }

  subdivide() {
    const { minLat, minLon, maxLat, maxLon } = this.boundary;
    const midLat = (minLat + maxLat) / 2;
    const midLon = (minLon + maxLon) / 2;

    this.nw = new Quadtree(new BoundingBox(midLat, minLon, maxLat, midLon), this.capacity);
    this.ne = new Quadtree(new BoundingBox(midLat, midLon, maxLat, maxLon), this.capacity);
    this.sw = new Quadtree(new BoundingBox(minLat, minLon, midLat, midLon), this.capacity);
    this.se = new Quadtree(new BoundingBox(minLat, midLon, midLat, maxLon), this.capacity);

    this.divided = true;
  }

  insert(point) {
    if (!this.boundary.contains(point.lat, point.lon)) {
      return false;
    }

    if (this.points.length < this.capacity && !this.divided) {
      this.points.push(point);
      return true;
    }

    if (!this.divided) {
      this.subdivide();
    }

    if (this.nw.insert(point)) return true;
    if (this.ne.insert(point)) return true;
    if (this.sw.insert(point)) return true;
    if (this.se.insert(point)) return true;

    return false;
  }

  queryRange(range, found = []) {
    if (!this.boundary.intersects(range)) {
      return found;
    }

    for (let p of this.points) {
      if (range.contains(p.lat, p.lon)) {
        found.push(p);
      }
    }

    if (this.divided) {
      this.nw.queryRange(range, found);
      this.ne.queryRange(range, found);
      this.sw.queryRange(range, found);
      this.se.queryRange(range, found);
    }

    return found;
  }

  queryRadius(centerLat, centerLon, radiusKm, found = []) {
    // Approximate bounding box for radius in degrees (1 deg ~ 111 km)
    const latDelta = radiusKm / 111;
    const lonDelta = radiusKm / (111 * Math.cos((centerLat * Math.PI) / 180));

    const searchBox = new BoundingBox(
      centerLat - latDelta,
      centerLon - lonDelta,
      centerLat + latDelta,
      centerLon + lonDelta
    );

    const candidates = [];
    this.queryRange(searchBox, candidates);

    candidates.forEach(point => {
      const dist = calculateHaversineDistance(centerLat, centerLon, point.lat, point.lon);
      if (dist <= radiusKm) {
        found.push({
          ...point,
          distanceKm: Math.round(dist * 10) / 10
        });
      }
    });

    return found.sort((a, b) => a.distanceKm - b.distanceKm);
  }
}
