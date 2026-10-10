import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import authRouter from '../backend/gateway/routes/auth.js';
import { authService } from '../backend/services/identity-service/AuthService.js';

test('POST /auth/signup forwards confirmPassword to the identity service', async () => {
    const originalRegisterUser = authService.registerUser;
    let receivedSignupData = null;
    authService.registerUser = async (signupData) => {
        receivedSignupData = signupData;
        return {
            user: {
                id: 'usr_signup_route_test',
                email: signupData.email,
                accountStatus: 'PENDING_EMAIL_VERIFICATION'
            },
            verification: {
                required: true,
                emailSent: true,
                expiresInMinutes: 10,
                message: 'Verification email sent.'
            }
        };
    };

    const app = express();
    app.use(express.json());
    app.use('/api/v1/auth', authRouter);
    const server = app.listen(0, '127.0.0.1');

    try {
        await new Promise((resolve, reject) => {
            server.once('listening', resolve);
            server.once('error', reject);
        });

        const address = server.address();
        const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/auth/signup`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                firstName: 'Signup',
                lastName: 'Regression',
                email: 'signup-route-regression@example.com',
                password: 'Password@2026',
                confirmPassword: 'Password@2026',
                mobile: '9876543210',
                dateOfBirth: '1992-06-20',
                gender: 'PREFER_NOT_TO_SAY'
            })
        });

        const body = await response.json();
        assert.equal(response.status, 201, JSON.stringify(body));
        assert.equal(receivedSignupData?.password, 'Password@2026');
        assert.equal(receivedSignupData?.confirmPassword, 'Password@2026');
        assert.equal(body.success, true);
    } finally {
        authService.registerUser = originalRegisterUser;
        await new Promise((resolve) => server.close(resolve));
    }
});
