import { useState, useEffect, useCallback, useMemo } from 'react';
import apiClient from '../api/apiClient';
import { useAuth } from '../context/AuthContext';

/**
 * Custom Hook: useRiderManagement
 * Encapsulates fleet data loading, status toggling, GPS tracking, and assignment engine telemetry.
 */
export function useRiderManagement({ includeDisabled = false } = {}) {
    const { isAdmin, loading: authLoading } = useAuth();
    const [riders, setRiders] = useState([]);
    const [loadingRiders, setLoadingRiders] = useState(false);
    const [ridersError, setRidersError] = useState(null);

    const [engineStatus, setEngineStatus] = useState({
        pipeline: [],
        logs: [],
        totalEvaluations: 0
    });
    const [loadingEngine, setLoadingEngine] = useState(false);

    const fetchRiders = useCallback(async (filter = {}) => {
        if (authLoading || !isAdmin) return;
        setLoadingRiders(true);
        setRidersError(null);
        try {
            const params = {};
            if (filter.status) params.status = filter.status;
            if (filter.search) params.search = filter.search;
            if (filter.includeDisabled ?? includeDisabled) params.includeDisabled = true;
            const res = await apiClient.get('/api/admin/riders', { params });
            setRiders(res.data || []);
        } catch (err) {
            setRidersError(err.response?.data?.message || err.message || 'Failed to load riders.');
        } finally {
            setLoadingRiders(false);
        }
    }, [authLoading, includeDisabled, isAdmin]);

    const fetchEngineStatus = useCallback(async () => {
        if (authLoading || !isAdmin) return;
        setLoadingEngine(true);
        try {
            const res = await apiClient.get('/api/admin/assignment/engine-status');
            setEngineStatus(res.data || { pipeline: [], logs: [], totalEvaluations: 0 });
        } catch (err) {
            console.warn('Failed to load assignment engine telemetry:', err.message);
        } finally {
            setLoadingEngine(false);
        }
    }, [authLoading, isAdmin]);

    const updateStatus = async (riderId, newStatus) => {
        try {
            const res = await apiClient.patch(`/api/admin/riders/${riderId}/status`, { status: newStatus });
            setRiders((prev) => prev.map((r) => (r.id === riderId ? res.data.rider : r)));
            return res.data;
        } catch (err) {
            throw new Error(err.response?.data?.message || err.message || 'Could not update rider status.');
        }
    };

    const setRiderEnabled = async (riderId, enabled, action, remark) => {
        try {
            const res = await apiClient.patch(`/api/admin/riders/${riderId}/enabled`, {
                enabled,
                action,
                remark
            });
            setRiders((prev) => prev.map((r) => (r.id === riderId ? res.data.rider : r)));
            return res.data;
        } catch (err) {
            throw new Error(err.response?.data?.message || err.message || 'Could not update rider availability.');
        }
    };

    useEffect(() => {
        if (!authLoading && isAdmin) {
            fetchRiders();
            fetchEngineStatus();
        }
    }, [fetchRiders, fetchEngineStatus]);

    const stats = useMemo(() => {
        const activeRiders = riders.filter((r) => r.enabled !== false);
        const available = activeRiders.filter((r) => r.status === 'Available').length;
        const busy = activeRiders.filter((r) => r.status === 'Busy').length;
        const offDuty = activeRiders.filter((r) => r.status === 'Off-duty').length;
        const totalActiveDeliveries = activeRiders.reduce((acc, r) => acc + (r.activeOrderIds?.length || 0), 0);
        return {
            total: activeRiders.length,
            available,
            busy,
            offDuty,
            totalActiveDeliveries
        };
    }, [riders]);

    return {
        riders,
        loadingRiders,
        ridersError,
        fetchRiders,
        updateStatus,
        setRiderEnabled,
        engineStatus,
        loadingEngine,
        fetchEngineStatus,
        stats
    };
}
