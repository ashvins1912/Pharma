import apiClient from './apiClient';

export async function matchStoreMedicineToMaster(product) {
  const params = {
    name: String(product?.name || '').trim(),
    brand: String(product?.brand || '').trim(),
    genericName: String(product?.genericName || '').trim(),
    composition: String(product?.composition || '').trim(),
    strength: String(product?.strength || '').trim(),
    dosageForm: String(product?.dosageForm || product?.form || '').trim(),
    manufacturer: String(product?.manufacturer || '').trim()
  };
  const response = await apiClient.get('/api/v1/inventory/catalogue/medicines/match', { params });
  return response.data?.data || response.data;
}
