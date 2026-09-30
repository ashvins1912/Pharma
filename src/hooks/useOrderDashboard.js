import { useState, useEffect, useCallback, useMemo } from 'react';
import apiClient from '../api/apiClient';

/**
 * Custom Hook: useOrderDashboard
 * Decouples order assignment, review, and fulfillment workflows from presentation components.
 */
export function useOrderDashboard() {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [assignmentExecuting, setAssignmentExecuting] = useState(false);
    const [lastAssignmentResult, setLastAssignmentResult] = useState(null);

    const loadOrders = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await apiClient.get('/api/orders/admin/all');
            setOrders(res.data || []);
        } catch (err) {
            setError(err.response?.data?.message || err.message || 'Could not load order dashboard.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadOrders();
    }, [loadOrders]);

    // Feature 2: Trigger automated assignment engine pipeline
    const autoAssignOrder = async (orderId) => {
        setAssignmentExecuting(true);
        try {
            const res = await apiClient.post(`/api/admin/assignment/orders/${orderId}/auto-assign`);
            setLastAssignmentResult(res.data);
            await loadOrders();
            return res.data;
        } catch (err) {
            const msg = err.response?.data?.message || err.message || 'Automated assignment failed.';
            throw new Error(msg);
        } finally {
            setAssignmentExecuting(false);
        }
    };

    // Manual override assignment
    const manualAssignOrder = async (orderId, riderId, notes = 'Manual dispatch override') => {
        setAssignmentExecuting(true);
        try {
            const res = await apiClient.post(`/api/admin/assignment/orders/${orderId}/manual-assign`, {
                riderId,
                notes
            });
            setLastAssignmentResult(res.data);
            await loadOrders();
            return res.data;
        } catch (err) {
            const msg = err.response?.data?.message || err.message || 'Manual assignment failed.';
            throw new Error(msg);
        } finally {
            setAssignmentExecuting(false);
        }
    };

    // Pharmacist review approval
    const reviewAndApproveOrder = async (orderId) => {
        setAssignmentExecuting(true);
        try {
            const res = await apiClient.put(`/api/orders/${orderId}/review`, {
                status: 'Approved',
                prescriptionVerified: true
            });
            await loadOrders();
            return res.data;
        } catch (err) {
            throw new Error(err.response?.data?.message || err.message || 'Order approval failed.');
        } finally {
            setAssignmentExecuting(false);
        }
    };

    // Grouping by fulfillment stage
    const groupedOrders = useMemo(() => {
        const unassigned = orders.filter(
            (o) => !o.rider?.riderId && !['Delivered', 'Cancelled', 'Rejected'].includes(o.orderStatus)
        );
        const assigned = orders.filter(
            (o) => Boolean(o.rider?.riderId) && !['Delivered', 'Cancelled'].includes(o.orderStatus)
        );
        const delivered = orders.filter((o) => o.orderStatus === 'Delivered');

        return {
            unassigned,
            assigned,
            delivered
        };
    }, [orders]);

    return {
        orders,
        loading,
        error,
        assignmentExecuting,
        lastAssignmentResult,
        loadOrders,
        autoAssignOrder,
        manualAssignOrder,
        reviewAndApproveOrder,
        groupedOrders
    };
}
