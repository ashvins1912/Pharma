// backend/middleware/auth.js

const { createRemoteJWKSet, jwtVerify } = require("jose");

const SUPABASE_URL = process.env.SUPABASE_URL;

if (!SUPABASE_URL) {
    throw new Error("SUPABASE_URL is not configured");
}

const SUPABASE_JWKS = createRemoteJWKSet(
    new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`)
);

const authenticateUser = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            message: "Access denied. Missing Bearer token."
        });
    }

    const token = authHeader.substring(7).trim();

    if (!token) {
        return res.status(401).json({
            message: "Access denied. Missing access token."
        });
    }

    try {
        const { payload } = await jwtVerify(token, SUPABASE_JWKS, {
            issuer: `${SUPABASE_URL}/auth/v1`,
            audience: "authenticated"
        });

        req.user = payload;

        next();
    } catch (error) {
        console.error("Supabase JWT verification failed:", error.message);

        return res.status(401).json({
            message: "Invalid session key credentials or token expired."
        });
    }
};

const isAdmin = (req, res, next) => {
    if (
        req.user?.role !== "admin" &&
        req.user?.user_metadata?.role !== "admin"
    ) {
        return res.status(403).json({
            message: "Access denied. Forbidden interface."
        });
    }

    next();
};

module.exports = {
    authenticateUser,
    isAdmin
};