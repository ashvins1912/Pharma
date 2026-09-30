import { useState, useCallback } from 'react';
import apiClient from '../api/apiClient';

/**
 * Custom Hook: useRiderOnboarding
 * Decouples onboarding business logic, file preparation, and validation from UI components.
 * Open for UI redesigns: Any form layout or modal can consume this hook without changes.
 */
export function useRiderOnboarding({ onSuccess, onError } = {}) {
    const initialValues = {
        name: '',
        mobile: '',
        vehicleType: 'Bike',
        latitude: '12.9716',
        longitude: '77.5946'
    };

    const [values, setValues] = useState(initialValues);
    const [photoFile, setPhotoFile] = useState(null);
    const [photoPreview, setPhotoPreview] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formErrors, setFormErrors] = useState({});

    const handleInputChange = useCallback((e) => {
        const { name, value } = e.target;
        setValues((prev) => ({ ...prev, [name]: value }));
        setFormErrors((prev) => ({ ...prev, [name]: null }));
    }, []);

    const handleFileChange = useCallback((e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate image mime type & size (5MB)
        if (!file.type.startsWith('image/')) {
            setFormErrors((prev) => ({ ...prev, photo: 'File must be an image (JPEG, PNG, WebP).' }));
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            setFormErrors((prev) => ({ ...prev, photo: 'Image must be smaller than 5MB.' }));
            return;
        }

        setPhotoFile(file);
        setFormErrors((prev) => ({ ...prev, photo: null }));

        const reader = new FileReader();
        reader.onloadend = () => {
            setPhotoPreview(reader.result);
        };
        reader.readAsDataURL(file);
    }, []);

    const validate = () => {
        const errors = {};
        if (!values.name?.trim()) {
            errors.name = 'Full name is required.';
        }
        if (!values.mobile?.trim()) {
            errors.mobile = 'Mobile phone number is required.';
        } else {
            const digits = values.mobile.replace(/\D/g, '');
            if (digits.length < 10) {
                errors.mobile = 'Enter a valid 10-digit phone number.';
            }
        }
        const lat = Number(values.latitude);
        const lng = Number(values.longitude);
        if (isNaN(lat) || lat < -90 || lat > 90) {
            errors.latitude = 'Latitude must be between -90 and 90.';
        }
        if (isNaN(lng) || lng < -180 || lng > 180) {
            errors.longitude = 'Longitude must be between -180 and 180.';
        }
        return errors;
    };

    const resetForm = useCallback(() => {
        setValues(initialValues);
        setPhotoFile(null);
        setPhotoPreview(null);
        setFormErrors({});
    }, []);

    const handleSubmit = async (e) => {
        if (e) e.preventDefault();
        const errors = validate();
        if (Object.keys(errors).length > 0) {
            setFormErrors(errors);
            return false;
        }

        setIsSubmitting(true);
        try {
            const formData = new FormData();
            formData.append('name', values.name.trim());
            formData.append('mobile', values.mobile.trim());
            formData.append('vehicleType', values.vehicleType);
            formData.append('latitude', values.latitude);
            formData.append('longitude', values.longitude);
            if (photoFile) {
                formData.append('photo', photoFile);
            }

            const { data } = await apiClient.post('/api/admin/riders/onboard', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });

            resetForm();
            if (onSuccess) onSuccess(data);
            return data;
        } catch (err) {
            const msg = err.response?.data?.message || err.message || 'Rider onboarding failed.';
            setFormErrors((prev) => ({ ...prev, server: msg }));
            if (onError) onError(msg);
            throw new Error(msg);
        } finally {
            setIsSubmitting(false);
        }
    };

    return {
        values,
        photoFile,
        photoPreview,
        isSubmitting,
        formErrors,
        handleInputChange,
        handleFileChange,
        handleSubmit,
        resetForm,
        setValues
    };
}
