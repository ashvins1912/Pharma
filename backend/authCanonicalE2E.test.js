import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { gatewayRouter } from './gateway/gatewayRouter.js';
import { authService } from './services/identity-service/AuthService.js';

function extractCookie(response, name) {
  const cookies = response.headers.getSetCookie?.() || [];
  const match = cookies.find(value => value.startsWith(name + '='));
  return match ? match.split(';', 1)[0] : '';
}

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', gatewayRouter);
  return await new Promise(resolve => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('HTTP E2E: email signup -> activation state -> Pharma login -> /me', async () => {
  const server = await startServer();
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const email = 'e2e-email-' + Date.now() + '@example.com';

    const signup = await fetch(base + '/api/v1/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'E2E Email User',
        email,
        password: 'Password@2026',
        mobile: '9876543210',
        dateOfBirth: '1994-01-10',
        gender: 'PREFER_NOT_TO_SAY'
      })
    });
    assert.equal(signup.status, 201);

    const created = await authService.findUser({ normalizedEmail: email });
    created.emailVerified = true;
    created.accountStatus = 'ACTIVE';
    created.status = 'ACTIVE';
    await authService.saveUser(created.userId, created);

    const login = await fetch(base + '/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'Password@2026' })
    });
    assert.equal(login.status, 200);
    const accessCookie = extractCookie(login, 'access_token');
    assert.ok(accessCookie);

    const me = await fetch(base + '/api/v1/auth/me', {
      headers: { cookie: accessCookie }
    });
    assert.equal(me.status, 200);
    const meBody = await me.json();
    assert.equal((meBody.data || meBody).user.email, email);
  } finally {
    server.close();
  }
});

test('HTTP E2E: first-time Google identity gets restricted onboarding then completes profile', async () => {
  const server = await startServer();
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const email = 'e2e-google-' + Date.now() + '@gmail.com';

    const google = await fetch(base + '/api/v1/auth/google', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providerUserId: 'google-' + Date.now(),
        email,
        email_verified: true,
        firstName: 'Google',
        lastName: 'User'
      })
    });
    assert.equal(google.status, 200);
    const googleBody = await google.json();
    const googleData = googleBody.data || googleBody;
    assert.equal(googleData.code, 'PROFILE_INCOMPLETE');
    const onboardingCookie = extractCookie(google, 'access_token');
    assert.ok(onboardingCookie);

    const forbidden = await fetch(base + '/api/v1/orders', {
      headers: { cookie: onboardingCookie }
    });
    assert.ok([401, 403, 404].includes(forbidden.status));

    const complete = await fetch(base + '/api/v1/auth/complete-profile', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: onboardingCookie
      },
      body: JSON.stringify({
        firstName: 'Google',
        lastName: 'User',
        dateOfBirth: '1995-05-10',
        gender: 'PREFER_NOT_TO_SAY',
        mobileNumber: '9876543211'
      })
    });
    assert.equal(complete.status, 200);
    const completeCookie = extractCookie(complete, 'access_token');
    assert.ok(completeCookie);
  } finally {
    server.close();
  }
});

test('HTTP E2E: Google cannot bypass suspended account policy', async () => {
  const email = 'e2e-suspended-google-' + Date.now() + '@example.com';
  await authService.saveUser('suspended-' + Date.now(), {
    email,
    normalizedEmail: email,
    passwordHash: null,
    emailVerified: true,
    accountStatus: 'SUSPENDED',
    status: 'SUSPENDED',
    profileCompleted: true,
    role: 'customer',
    roles: ['customer']
  });

  const server = await startServer();
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const google = await fetch(base + '/api/v1/auth/google', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providerUserId: 'google-suspended-' + Date.now(),
        email,
        email_verified: true,
        firstName: 'Suspended',
        lastName: 'User'
      })
    });
    assert.equal(google.status, 403);
  } finally {
    server.close();
  }
});
