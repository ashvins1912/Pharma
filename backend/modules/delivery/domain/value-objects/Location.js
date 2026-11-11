/**
 * Value Object: Location (GeoJSON Point)
 * Immutable representation of geographic coordinates with distance calculation
 */
export class Location {
    /**
     * @param {number} longitude 
     * @param {number} latitude 
     */
    constructor(longitude, latitude) {
        const lng = Number(longitude);
        const lat = Number(latitude);

        if (isNaN(lng) || lng < -180 || lng > 180) {
            throw new Error(`Invalid longitude: ${longitude}. Must be between -180 and 180.`);
        }
        if (isNaN(lat) || lat < -90 || lat > 90) {
            throw new Error(`Invalid latitude: ${latitude}. Must be between -90 and 90.`);
        }

        this.type = 'Point';
        this.coordinates = [lng, lat]; // GeoJSON convention: [longitude, latitude]
        Object.freeze(this);
    }

    get longitude() {
        return this.coordinates[0];
    }

    get latitude() {
        return this.coordinates[1];
    }

    toGeoJSON() {
        return {
            type: 'Point',
            coordinates: [this.longitude, this.latitude]
        };
    }

    /**
     * Calculate Great-Circle distance using Haversine formula
     * @param {Location} otherLocation 
     * @returns {number} Distance in meters
     */
    distanceTo(otherLocation) {
        if (!(otherLocation instanceof Location)) {
            otherLocation = new Location(otherLocation.coordinates?.[0] ?? otherLocation.lng, otherLocation.coordinates?.[1] ?? otherLocation.lat);
        }

        const R = 6371e3; // Earth radius in meters
        const φ1 = (this.latitude * Math.PI) / 180;
        const φ2 = (otherLocation.latitude * Math.PI) / 180;
        const Δφ = ((otherLocation.latitude - this.latitude) * Math.PI) / 180;
        const Δλ = ((otherLocation.longitude - this.longitude) * Math.PI) / 180;

        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                  Math.cos(φ1) * Math.cos(φ2) *
                  Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c; // in meters
    }

    /**
     * Helper to return distance in kilometers rounded to 2 decimals
     */
    distanceInKm(otherLocation) {
        return Number((this.distanceTo(otherLocation) / 1000).toFixed(2));
    }

    static fromCoordinates(lng, lat) {
        return new Location(lng, lat);
    }
}
