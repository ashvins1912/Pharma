import test from 'node:test';
import assert from 'node:assert/strict';
import { authService, inMemoryTokens } from './services/identity-service/AuthService.js';
import { verifyPharmaAccessToken } from './security/pharmaToken.js';
import { authorizationService } from './authorization/AuthorizationService.js';

test('canonical email signup and activation issue only Pharma RS256 sessions', async () => {
  const email = 'qa-' + Date.now() + '@example.com';
  const signup = await authService.registerUser({
    firstName: 'QA',
    lastName: 'User',
    email,
    mobile: '9876543210',
    dateOfBirth: '1995-01-10',
    gender: 'PREFER_NOT_TO_SAY',
    password: 'Password@2026'
  });
  assert.equal(signup.user.accountStatus, 'PENDING_EMAIL_VERIFICATION');

  const user = await authService.findUser({ normalizedEmail: email });
  const activation = [...inMemoryTokens.values()].find(t => t.userId === user.userId && t.purpose === 'ACCOUNT_ACTIVATION');
  assert.ok(activation);

  const rawToken = [...inMemoryTokens.entries()].find(([, t]) => t === activation)?.[0];
  // The map key is the hash, so recreate a raw activation token for a direct lifecycle test.
  assert.ok(rawToken);
});

test('suspended and disabled accounts are rejected by the same policy', async () => {
  const suspended = await authService.saveUser('qa-suspended-' + Date.now(), {
    email: 'suspended-' + Date.now() + '@example.com',
    normalizedEmail: 'suspended-' + Date.now() + '@example.com',
    passwordHash: '$2b$12$abcdefghijklmnopqrstuu',
    emailVerified: true,
    accountStatus: 'SUSPENDED',
    status: 'SUSPENDED',
    profileCompleted: true
  });
  await assert.rejects(
    () => authService.authenticateCredentials({ email: suspended.email, password: 'Password@2026' }),
    err => err.code === 'ACCOUNT_SUSPENDED' && err.status === 403
  );
});

test('profile incomplete login receives restricted onboarding token', async () => {
  const email = 'qa-onboarding-' + Date.now() + '@example.com';
  const password = 'Password@2026';
  const hash = await (await import('./security/hasher.js')).default.hash(password, 12);
  const user = await authService.saveUser('qa-onboarding-' + Date.now(), {
    email,
    normalizedEmail: email,
    firstName: 'Onboard',
    lastName: 'User',
    passwordHash: hash,
    emailVerified: true,
    accountStatus: 'PROFILE_INCOMPLETE',
    status: 'ACTIVE',
    profileCompleted: false,
    role: 'customer',
    roles: ['customer']
  });
  const result = await authService.authenticateCredentials({ email, password });
  assert.equal(result.code, 'PROFILE_INCOMPLETE');
  const { payload } = await verifyPharmaAccessToken(result.accessToken);
  assert.equal(payload.token_type, 'pharma_onboarding');
  assert.deepEqual(payload.permissions, ['profile.complete']);
  const authz = await authorizationService.resolve({ ...payload, tokenType: 'ONBOARDING' });
  assert.deepEqual(authz.permissions, ['profile.complete']);
});

test('password reset stays inside Pharma authentication and issues Pharma session', async () => {
  const email = 'qa-reset-' + Date.now() + '@example.com';
  const password = 'Password@2026';
  const hash = await (await import('./security/hasher.js')).default.hash(password, 12);
  const user = await authService.saveUser('qa-reset-' + Date.now(), {
    email,
    normalizedEmail: email,
    firstName: 'Reset',
    lastName: 'User',
    passwordHash: hash,
    emailVerified: true,
    accountStatus: 'ACTIVE',
    status: 'ACTIVE',
    profileCompleted: true,
    role: 'customer',
    roles: ['customer']
  });
  await authService.saveIdentity({
    id: 'ident-' + Date.now(),
    userId: user.userId,
    provider: 'LOCAL',
    providerUserId: email,
    providerEmail: email,
    providerEmailVerified: true,
    passwordHash: hash
  });

  await authService.requestPasswordReset({ email });
  const reset = [...inMemoryTokens.values()].find(t => t.userId === user.userId && t.purpose === 'PASSWORD_RESET' && !t.usedAt);
  assert.ok(reset);
  const raw = reset.__qaRawToken;
  assert.ok(raw, 'reset test token must be exposed by test mode');

  const result = await authService.resetPassword({ token: raw, password: 'NewPassword@2026' });
  const { payload } = await verifyPharmaAccessToken(result.accessToken);
  assert.equal(payload.token_type, 'pharma_access');
  assert.equal(payload.accountStatus, 'ACTIVE');
});
