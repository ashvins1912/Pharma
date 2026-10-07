import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, SignJWT, importPKCS8, importSPKI } from 'jose';
import { env } from '../config/env.js';

const ISSUER = env.PHARMA_JWT_ISSUER;
const AUDIENCE = env.PHARMA_JWT_AUDIENCE;
const ACCESS_TTL = env.PHARMA_ACCESS_TOKEN_TTL || '10m';

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

export async function verifyPharmaAccessToken(token) {
  const { publicKey } = await getKeys();
  return jwtVerify(token, publicKey, {
    algorithms: ['RS256'],
    issuer: ISSUER,
    audience: AUDIENCE
  });
}

let supabaseJwks;
export async function verifySupabaseExchangeToken(token) {
  if (!env.SUPABASE_URL || !token) throw new Error('Supabase exchange token is unavailable.');
  if (!supabaseJwks) {
    supabaseJwks = createRemoteJWKSet(
      new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`)
    );
  }
  return jwtVerify(token, supabaseJwks, {
    issuer: `${env.SUPABASE_URL}/auth/v1`,
    audience: 'authenticated'
  });
}
