import apiClient from './apiClient';

export async function addRiderProfile(riderData) {
  const { data } = await apiClient.post('/api/riders', riderData);
  return data.rider;
}

export async function fetchRiderProfile() {
  const { data } = await apiClient.get('/api/riders/profile');
  return data.rider;
}
