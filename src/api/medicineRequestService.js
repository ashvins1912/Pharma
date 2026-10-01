import apiClient from './apiClient';

export const createMedicineRequest = async (formData) => {
  const isMultipart = formData instanceof FormData;
  const config = isMultipart
    ? { headers: { 'Content-Type': 'multipart/form-data' } }
    : {};
  const response = await apiClient.post('/api/medicine-requests', formData, config);
  return response.data;
};

export const getCustomerMedicineRequests = async (params = {}) => {
  const response = await apiClient.get('/api/medicine-requests', { params });
  return response.data?.requests || [];
};

export const getCustomerMedicineRequestsPage = async (params = {}) => {
  const response = await apiClient.get('/api/medicine-requests', { params });
  return response.data;
};

export const getMyProposals = async () => {
  const response = await apiClient.get('/api/proposals/my-proposals');
  return response.data?.proposals || [];
};

export const getMedicineRequestById = async (id) => {
  const response = await apiClient.get(`/api/medicine-requests/${id}`);
  return response.data?.request || null;
};

export const approveProposal = async (id, approvalNote = '') => {
  const response = await apiClient.post(`/api/medicine-requests/${id}/approve`, { approvalNote });
  return response.data;
};

export const rejectProposal = async (id, reason = '') => {
  const response = await apiClient.post(`/api/medicine-requests/${id}/reject`, { reason });
  return response.data;
};

// Admin & Pharmacy APIs
export const getAdminMedicineRequests = async (params = {}) => {
  const response = await apiClient.get('/api/admin/medicine-requests', { params });
  return response.data?.requests || [];
};

export const getAdminMedicineRequestMetrics = async () => {
  const response = await apiClient.get('/api/admin/medicine-requests/metrics/overview');
  return response.data;
};

export const reviewMedicineRequest = async (id) => {
  const response = await apiClient.put(`/api/admin/medicine-requests/${id}/review`);
  return response.data?.request;
};

export const sendPharmacyProposal = async (id, proposalData) => {
  const response = await apiClient.post(`/api/admin/medicine-requests/${id}/proposal`, proposalData);
  return response.data?.request;
};

export const updatePharmacyProposal = async (id, proposalData) => {
  const response = await apiClient.put(`/api/admin/medicine-requests/${id}/proposal`, proposalData);
  return response.data?.request;
};

export const rejectMedicineRequestByPharmacy = async (id, reason = '') => {
  const response = await apiClient.post(`/api/admin/medicine-requests/${id}/reject-request`, { reason });
  return response.data?.request;
};
