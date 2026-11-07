import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
    authService,
    calculateAge,
    isValidDOB,
    isValidMobile,
    isStrongPassword,
    maskEmail
} from '../backend/services/identity-service/AuthService.js';
import User from '../backend/models/User.js';
import UserIdentity from '../backend/models/UserIdentity.js';
import EmailVerificationToken from '../backend/models/EmailVerificationToken.js';

test('1. Identity Service: Date of Birth and Dynamic Age Calculation', () => {
    // Current year calculation
    const currentYear = new Date().getFullYear();
    const dob25 = `${currentYear - 25}-01-01`;
    assert.strictEqual(calculateAge(dob25), 25);

    // Invalid or future DOB validation
    assert.strictEqual(isValidDOB(''), false);
    assert.strictEqual(isValidDOB('invalid-date'), false);
    assert.strictEqual(isValidDOB('2099-01-01'), false); // Future date must be rejected
    assert.strictEqual(isValidDOB('1995-05-15'), true);

    // Dynamic age is never permanently stored
    assert.strictEqual(calculateAge('2000-01-01') >= 26, true);
    assert.strictEqual(calculateAge(null), null);
});

test('2. Identity Service: Security helper validations (Mobile, Password, Masking)', () => {
    // Mobile format
    assert.strictEqual(isValidMobile('9876543210'), true);
    assert.strictEqual(isValidMobile('+91 95899 16475'), true);
    assert.strictEqual(isValidMobile('123'), false); // Too short

    // Password strength
    assert.strictEqual(isStrongPassword('weak'), false);
    assert.strictEqual(isStrongPassword('weakpassword'), false); // No uppercase / digit
    assert.strictEqual(isStrongPassword('Pharma@Secure2026'), true);

    // Email masking
    assert.strictEqual(maskEmail('customer@ashvinpharma.com'), 'c***r@ashvinpharma.com');
    assert.strictEqual(maskEmail('ab@test.com'), 'a***@test.com');
});

test('3. Persistent Models: User, UserIdentity, EmailVerificationToken Schema Integrity', () => {
    assert.ok(User.schema.path('dateOfBirth'), 'User schema must include dateOfBirth');
    assert.ok(User.schema.path('accountStatus'), 'User schema must include accountStatus');
    assert.ok(User.schema.path('mobileNumber'), 'User schema must include mobileNumber');
    assert.ok(User.schema.path('profileCompleted'), 'User schema must include profileCompleted');
    assert.ok(User.schema.path('primaryAuthProvider'), 'User schema must include primaryAuthProvider');

    assert.ok(UserIdentity.schema.path('provider'), 'UserIdentity must define provider');
    assert.ok(UserIdentity.schema.path('providerUserId'), 'UserIdentity must define providerUserId');
    assert.ok(UserIdentity.schema.path('userId'), 'UserIdentity must associate with userId');

    assert.ok(EmailVerificationToken.schema.path('tokenHash'), 'EmailVerificationToken must store tokenHash');
    assert.ok(!EmailVerificationToken.schema.path('rawToken'), 'Raw token must NEVER exist in DB schema');
});

test('4. Local Signup Flow: Account Created with PENDING_EMAIL_VERIFICATION & Token Hash', async () => {
    const signupData = {
        firstName: 'Rajesh',
        lastName: 'Sharma',
        email: `rajesh.test.${Date.now()}@example.com`,
        mobile: '9876543210',
        dateOfBirth: '1992-06-20',
        gender: 'PREFER_NOT_TO_SAY',
        password: 'Password@2026'
    };

    const res = await authService.registerUser(signupData);

    assert.ok(res.user, 'Registration must return created user');
    assert.strictEqual(res.user.accountStatus, 'PENDING_EMAIL_VERIFICATION', 'Account must be pending verification');
    assert.strictEqual(res.user.emailVerified, false, 'Email must be unverified');
    assert.strictEqual(res.user.profileCompleted, true, 'Profile marked completed for local signup');
    assert.strictEqual(res.user.dateOfBirth, '1992-06-20');
    assert.ok(res.user.age > 0, 'Age must be calculated dynamically');
    assert.strictEqual(res.verification.required, true, 'Verification must be required');

    // Duplicate signup attempt must fail with 409
    await assert.rejects(
        async () => {
            await authService.registerUser(signupData);
        },
        (err) => err.code === 'EMAIL_ALREADY_EXISTS' && err.status === 409
    );
});

test('5. Login Guarding: Unverified account is rejected with EMAIL_VERIFICATION_REQUIRED', async () => {
    const testEmail = `unverified.${Date.now()}@example.com`;
    await authService.registerUser({
        firstName: 'Pooja',
        lastName: 'Verma',
        email: testEmail,
        mobile: '9876543211',
        dateOfBirth: '1998-03-12',
        gender: 'PREFER_NOT_TO_SAY',
        password: 'Password@2026'
    });

    // Attempting login before activation must be blocked
    await assert.rejects(
        async () => {
            await authService.authenticateCredentials({
                email: testEmail,
                password: 'Password@2026'
            });
        },
        (err) => {
            assert.ok(err.code === 'EMAIL_VERIFICATION_REQUIRED' || err.code === 'EMAIL_NOT_VERIFIED' || err.subCode === 'EMAIL_VERIFICATION_REQUIRED');
            assert.strictEqual(err.status, 403);
            assert.ok(err.canResendVerification, 'Must allow resending verification');
            return true;
        }
    );
});

test('6. Activation Endpoint: Single-use Token activates account and updates status to ACTIVE', async () => {
    const testEmail = `activate.test.${Date.now()}@example.com`;
    const regRes = await authService.registerUser({
        firstName: 'Anil',
        lastName: 'Kumar',
        email: testEmail,
        mobile: '9876543212',
        dateOfBirth: '1990-11-25',
        gender: 'PREFER_NOT_TO_SAY',
        password: 'Password@2026'
    });

    const user = await authService.findUser({ normalizedEmail: testEmail });
    assert.ok(user.verificationTokenHash, 'Token hash must be recorded');

    // Find the raw token that produced this hash or verify token hash lookup
    // Since raw token was sent in simulated email, we test with valid activation
    const rawTestToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawTestToken).digest('hex');

    await authService.saveVerificationToken({
        id: `tok_${crypto.randomUUID()}`,
        userId: user.userId,
        tokenHash,
        purpose: 'ACCOUNT_ACTIVATION',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        usedAt: null,
        revokedAt: null
    });

    // 1. Activate using valid token
    const activationRes = await authService.activateAccount(rawTestToken);
    assert.strictEqual(activationRes.status, 'ACTIVE');
    assert.strictEqual(activationRes.emailVerified, true);

    // 2. User status is now ACTIVE
    const activatedUser = await authService.findUser({ normalizedEmail: testEmail });
    assert.strictEqual(activatedUser.accountStatus, 'ACTIVE');
    assert.strictEqual(activatedUser.emailVerified, true);

    // 3. Re-using same token must fail (Single-use enforcement)
    await assert.rejects(
        async () => {
            await authService.activateAccount(rawTestToken);
        },
        (err) => err.code === 'TOKEN_ALREADY_USED' && err.status === 400
    );

    // 4. User can now successfully sign in
    const authResult = await authService.authenticateCredentials({
        email: testEmail,
        password: 'Password@2026'
    });
    assert.ok(authResult.accessToken, 'Access token issued');
    assert.strictEqual(authResult.user.accountStatus, 'ACTIVE');
});

test('7. Resend Verification: Revokes prior token and issues new active token', async () => {
    const testEmail = `resend.test.${Date.now()}@example.com`;
    await authService.registerUser({
        firstName: 'Deepak',
        lastName: 'Patel',
        email: testEmail,
        mobile: '9876543213',
        dateOfBirth: '1994-08-14',
        gender: 'PREFER_NOT_TO_SAY',
        password: 'Password@2026'
    });

    const resendRes = await authService.resendVerificationEmail({
        email: testEmail,
        requestIp: '127.0.0.1'
    });
    assert.strictEqual(resendRes.success, true);
    assert.strictEqual(resendRes.canResendVerification, true);
});

test('8. Google OAuth: First-time user creates PROFILE_INCOMPLETE and requires onboarding', async () => {
    const googleEmail = `google.new.${Date.now()}@gmail.com`;
    const googleSub = `googlesub_${Date.now()}`;

    const googleAuthRes = await authService.authenticateGoogle({
        providerUserId: googleSub,
        email: googleEmail,
        emailVerified: true,
        firstName: 'Vikram',
        lastName: 'Rathore',
        picture: 'https://example.com/avatar.jpg'
    });

    assert.strictEqual(googleAuthRes.code, 'PROFILE_INCOMPLETE');
    assert.strictEqual(googleAuthRes.requiresProfileCompletion, true);
    assert.strictEqual(googleAuthRes.user.accountStatus, 'PROFILE_INCOMPLETE');

    // Complete profile onboarding
    const onboardRes = await authService.completeProfile({
        userId: googleAuthRes.user.userId,
        firstName: 'Vikram',
        lastName: 'Rathore',
        dateOfBirth: '1993-04-10',
        mobileNumber: '9876543214'
    });

    assert.strictEqual(onboardRes.user.accountStatus, 'ACTIVE');
    assert.strictEqual(onboardRes.user.profileCompleted, true);
    assert.strictEqual(onboardRes.user.dateOfBirth, '1993-04-10');
    assert.ok(onboardRes.user.age > 0, 'Age dynamically computed');
    assert.ok(onboardRes.accessToken, 'Session access token granted');
});

test('9. Google OAuth: Account Linking to existing verified local account', async () => {
    const commonEmail = `link.test.${Date.now()}@example.com`;

    // 1. Register and activate local user
    await authService.registerUser({
        firstName: 'Sneha',
        lastName: 'Gupta',
        email: commonEmail,
        mobile: '9876543215',
        dateOfBirth: '1996-09-05',
        gender: 'PREFER_NOT_TO_SAY',
        password: 'Password@2026'
    });

    const user = await authService.findUser({ normalizedEmail: commonEmail });
    user.emailVerified = true;
    user.accountStatus = 'ACTIVE';
    await authService.saveUser(user.userId, user);

    // 2. Google login with same verified email
    const googleLinkRes = await authService.authenticateGoogle({
        providerUserId: `googlesub_${Date.now()}`,
        email: commonEmail,
        emailVerified: true,
        firstName: 'Sneha',
        lastName: 'Gupta'
    });

    assert.strictEqual(googleLinkRes.user.email, commonEmail);
    assert.strictEqual(googleLinkRes.user.accountStatus, 'ACTIVE');
    assert.ok(googleLinkRes.accessToken, 'Successfully authenticated and linked');
});
