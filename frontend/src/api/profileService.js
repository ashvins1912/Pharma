import apiClient from './apiClient';

export async function fetchProfile() {
  const { data } = await apiClient.get('/api/profile');
  return { profile: data.profile, addresses: data.addresses || [] };
}

export async function updateProfile(profileData) {
  const { data } = await apiClient.put('/api/profile', profileData);
  return data.profile;
}

export async function addAddress(addressData) {
  const { data } = await apiClient.post('/api/profile/addresses', addressData);
  return data.address;
}

export async function deleteAddress(addressId) {
  const { data } = await apiClient.delete(`/api/profile/addresses/${encodeURIComponent(addressId)}`);
  return data;
}
