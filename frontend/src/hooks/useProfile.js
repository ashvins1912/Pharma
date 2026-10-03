import { useCallback, useEffect, useState } from 'react';
import {
  addAddress as addProfileAddress,
  deleteAddress as deleteProfileAddress,
  fetchProfile,
  updateProfile as saveProfile
} from '../api/profileService';

export function useProfile({ enabled = true } = {}) {
  const [profile, setProfile] = useState(null);
  const [addresses, setAddresses] = useState([]);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const loadProfile = useCallback(async () => {
    if (!enabled) return null;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchProfile();
      setProfile(result.profile);
      setAddresses(result.addresses);
      return result;
    } catch (requestError) {
      setError(requestError?.message || 'Could not load profile.');
      throw requestError;
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }
    let active = true;
    setLoading(true);
    setError(null);
    fetchProfile()
      .then((result) => {
        if (!active) return;
        setProfile(result.profile);
        setAddresses(result.addresses);
      })
      .catch((requestError) => {
        if (active) setError(requestError?.message || 'Could not load profile.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [enabled]);

  const updateProfile = useCallback(async (profileData) => {
    setSaving(true);
    setError(null);
    try {
      const updated = await saveProfile(profileData);
      setProfile(updated);
      return updated;
    } catch (requestError) {
      setError(requestError?.message || 'Could not update profile.');
      throw requestError;
    } finally {
      setSaving(false);
    }
  }, []);

  const addAddress = useCallback(async (addressData) => {
    setSaving(true);
    setError(null);
    try {
      const created = await addProfileAddress(addressData);
      setAddresses((current) => [
        ...(created.isDefault
          ? current.map((address) => ({ ...address, isDefault: false }))
          : current),
        created
      ]);
      return created;
    } catch (requestError) {
      setError(requestError?.message || 'Could not save address.');
      throw requestError;
    } finally {
      setSaving(false);
    }
  }, []);

  const deleteAddress = useCallback(async (addressId) => {
    setSaving(true);
    setError(null);
    try {
      const result = await deleteProfileAddress(addressId);
      const nextAddresses = result.addresses || [];
      setAddresses(nextAddresses);
      return nextAddresses;
    } catch (requestError) {
      setError(requestError?.message || 'Could not delete address.');
      throw requestError;
    } finally {
      setSaving(false);
    }
  }, []);

  return {
    profile,
    addresses,
    loading,
    saving,
    error,
    loadProfile,
    updateProfile,
    addAddress,
    deleteAddress
  };
}
