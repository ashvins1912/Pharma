import crypto from 'node:crypto';
import { jwtVerify, SignJWT, importPKCS8, importSPKI, createRemoteJWKSet, decodeJwt } from 'jose';
import { env } from '../config/env.js';
import { createClient } from '@supabase/supabase-js';

const ISSUER = env.PHARMA_JWT_ISSUER;
const AUDIENCE = env.PHARMA_JWT_AUDIENCE;
const ACCESS_TTL = env.PHARMA_ACCESS_TOKEN_TTL || '1h';
const REFRESH_TTL = env.PHARMA_REFRESH_TOKEN_TTL || '7d';

let privateKeyPromise;
let publicKeyPromise;

function normalizePem(value) {
  return String(value || '').replace(/\\n/g, '\n').trim();
}

async function getKeys() {
  if (env.PHARMA_JWT_PRIVATE_KEY && env.PHARMA_JWT_PUBLIC_KEY) {
    if (!privateKeyPromise) {
      privateKeyPromise = importPKCS8(normalizePem(env.PHARMA_JWT_PRIVATE_KEY), 'RS256');
      publicKeyPromise = importSPKI(normalizePem(env.PHARMA_JWT_PUBLIC_KEY), 'RS256');
    }
    return { privateKey: await privateKeyPromise, publicKey: await publicKeyPromise };
  }

  if (env.NODE_ENV === 'production') {
    throw new Error('PHARMA_JWT_PRIVATE_KEY and PHARMA_JWT_PUBLIC_KEY are required in production.');
  }

  if (!privateKeyPromise) {
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
    privateKeyPromise = Promise.resolve(pair.privateKey);
    publicKeyPromise = Promise.resolve(pair.publicKey);
  }
  return { privateKey: await privateKeyPromise, publicKey: await publicKeyPromise };
}

export async function issuePharmaAccessToken(claims = {}) {
  const { privateKey } = await getKeys();
  const sub = String(claims.sub || '');
  if (!sub) throw new Error('Token subject is required.');

  const { expiresIn, ...tokenClaims } = claims;
  return new SignJWT({
    ...tokenClaims,
    token_type: claims.token_type || 'pharma_access'
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(sub)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(expiresIn || ACCESS_TTL)
    .sign(privateKey);
}

export async function issuePharmaRefreshToken(claims = {}) {
  const { privateKey } = await getKeys();
  const sub = String(claims.sub || '');
  if (!sub) throw new Error('Refresh token subject is required.');
  return new SignJWT({
    token_type: 'pharma_refresh',
    aal: claims.aal || 'aal1'
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(sub)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(REFRESH_TTL)
    .sign(privateKey);
}

export async function verifyPharmaRefreshToken(token) {
  const { publicKey } = await getKeys();
  return jwtVerify(token, publicKey, {
    algorithms: ['RS256'],
    issuer: ISSUER,
    audience: AUDIENCE
  });
}

export async function verifyPharmaAccessToken(token) {
  const { publicKey } = await getKeys();
  return jwtVerify(token, publicKey, {
    algorithms: ['RS256'],
    issuer: ISSUER,
    audience: AUDIENCE
  });
}

let supabaseAuthClient;
let supabaseJwks;

export async function verifySupabaseExchangeToken(token) {
  if (!env.SUPABASE_URL || !token) {
    const err = new Error('Supabase exchange token is unavailable.');
    err.code = 'SUPABASE_EXCHANGE_UNAVAILABLE';
    err.status = 503;
    throw err;
  }
  const baseUrl = String(env.SUPABASE_URL).replace(/\/$/, '');
  const expectedIssuer = baseUrl + '/auth/v1';

  let decoded;
  try {
    decoded = decodeJwt(token);
  } catch {
    const err = new Error('Supabase identity token is malformed.');
    err.code = 'INVALID_SUPABASE_EXCHANGE_TOKEN';
    err.status = 401;
    throw err;
  }

  if (decoded.iss !== expectedIssuer) {
    const err = new Error('Supabase identity token issuer is invalid.');
    err.code = 'INVALID_SUPABASE_EXCHANGE_TOKEN';
    err.status = 401;
    throw err;
  }

  try {
    if (!supabaseJwks) {
      supabaseJwks = createRemoteJWKSet(
        new URL(baseUrl + '/auth/v1/.well-known/jwks.json')
      );
    }

    const { payload } = await jwtVerify(token, supabaseJwks, {
      algorithms: ['ES256', 'RS256'],
      issuer: expectedIssuer,
      audience: 'authenticated'
    });

    if (!payload.sub || !payload.email) {
      throw new Error('Supabase identity is incomplete.');
    }

    return {
      payload: {
        sub: payload.sub,
        email: payload.email,
        email_verified: Boolean(payload.user_metadata?.email_verified ?? payload.email_verified ?? true),
        user_metadata: payload.user_metadata || {},
        app_metadata: payload.app_metadata || {},
        aud: payload.aud
      }
    };
  } catch (jwtError) {
    // Legacy fallback for Supabase projects using a non-asymmetric signing key.
    if (!supabaseAuthClient) {
      const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
      if (!key) {
        const err = new Error('Supabase server authentication is not configured.');
        err.code = 'SUPABASE_SERVER_KEY_MISSING';
        err.status = 503;
        throw err;
      }
      supabaseAuthClient = createClient(env.SUPABASE_URL, key, {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      });
    }

    const { data, error } = await supabaseAuthClient.auth.getUser(token);
    if (error || !data?.user) {
      const err = new Error('Supabase identity could not be verified.');
      err.code = 'INVALID_SUPABASE_EXCHANGE_TOKEN';
      err.status = 401;
      err.statusCode = 401;
      err.cause = jwtError;
      throw err;
    }

    return {
      payload: {
        sub: data.user.id,
        email: data.user.email,
        email_verified: Boolean(data.user.email_confirmed_at),
        user_metadata: data.user.user_metadata || {},
        app_metadata: data.user.app_metadata || {},
        aud: 'authenticated'
      }
    };
  }
}


export async function verifyGatewayTrustedRequestToken(token) {
  const secret = env.GATEWAY_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error('Gateway trust secret is not configured.');
  const secretKey = new TextEncoder().encode(secret);
  return jwtVerify(token, secretKey, {
    algorithms: ['HS256'],
    issuer: process.env.SERVICE_JWT_ISSUER || 'ashvin-pharmacy',
    audience: 'pharma-backend-trusted',
    subject: 'api-gateway'
  });
}
