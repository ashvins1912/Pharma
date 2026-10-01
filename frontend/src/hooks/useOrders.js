import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchOrders } from '../api/orderService';

export function useOrders(filters = {}) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const serializedFilters = useMemo(() => JSON.stringify(filters), [filters]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchOrders(JSON.parse(serializedFilters));
      setOrders(result);
      return result;
    } catch (requestError) {
      const message = requestError?.message || 'Could not fetch orders.';
      setError(message);
      throw requestError;
    } finally {
      setLoading(false);
    }
  }, [serializedFilters]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchOrders(JSON.parse(serializedFilters))
      .then((result) => {
        if (active) setOrders(result);
      })
      .catch((requestError) => {
        if (active) setError(requestError?.message || 'Could not fetch orders.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [serializedFilters]);

  return { orders, loading, error, refresh };
}
