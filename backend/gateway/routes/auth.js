    const phone = (mobileNumber || mobile || '').trim();

    const validationDetails = [];
    if (!firstName || !firstName.trim()) {
        validationDetails.push({ field: 'firstName', code: 'REQUIRED', message: 'First name is required.' });
    }
    if (!dateOfBirth) {
        validationDetails.push({ field: 'dateOfBirth', code: 'REQUIRED', message: 'Date of birth is required.' });
    } else if (!isValidDOB(dateOfBirth)) {
        validationDetails.push({ field: 'dateOfBirth', code: 'INVALID_DOB', message: 'Date of birth must be a valid past date.' });
    }
    // Mobile is intentionally optional during Phase-0 profile onboarding.
    // Validate it only when the user chooses to provide one.
    if (phone && !isValidMobile(phone)) {
        validationDetails.push({ field: 'mobileNumber', code: 'INVALID_MOBILE', message: 'Enter a valid Indian mobile number with at least 10 digits.' });
    }
    if (!gender || !['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'].includes(gender)) {
        validationDetails.push({ field: 'gender', code: 'INVALID_GENDER', message: 'Select a valid gender option.' });
    }

    if (validationDetails.length > 0) {
        return sendError(res, {
            code: 'VALIDATION_ERROR',
            message: 'Please complete all required fields.',
            details: validationDetails,
            statusCode: 400,
            req
        });
    }

    try {
        const result = await authService.completeProfile({
            userId,
            firstName,
            lastName,
            dateOfBirth,
            mobileNumber: phone,
            gender
        });

        if (result.accessToken) {
            setSessionCookies(res, { accessToken: result.accessToken });
        }

        return sendSuccess(res, {
            data: result,
            message: 'Profile completed successfully.',
            statusCode: 200,
            req
        });
    } catch (err) {
        return sendError(res, {
            code: err.code || 'PROFILE_ERROR',
            message: err.message || 'Failed to complete profile.',
            statusCode: err.status || 400,
            req
        });
    }