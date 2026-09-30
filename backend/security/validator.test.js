import assert from 'node:assert/strict';
import test from 'node:test';
import {
    sanitizeBodyMiddleware,
    sanitizeInput,
    validateLogin,
    validateSignup,
    validateTotp
} from './validator.js';

function runMiddleware(middleware, body) {
    const req = { body };
    let nextCalled = false;
    let statusCode;
    let responseBody;
    const res = {
        status(code) {
            statusCode = code;
            return this;
        },
        json(value) {
            responseBody = value;
            return this;
        }
    };

    middleware(req, res, () => {
        nextCalled = true;
    });
    return { req, nextCalled, statusCode, responseBody };
}

test('sanitizeInput removes Mongo operators and prototype-pollution keys', () => {
    const input = JSON.parse(
        '{"$gt":1,"nested":{"$ne":null,"safe.key":"value","valid":" value "},"__proto__":{"polluted":true},"password":" pass "}'
    );

    assert.deepEqual(sanitizeInput(input), {
        nested: { valid: 'value' },
        password: ' pass '
    });
    assert.equal({}.polluted, undefined);
});

test('sanitizeBodyMiddleware trims input but preserves password whitespace', () => {
    const result = runMiddleware(sanitizeBodyMiddleware, {
        email: ' user@example.com ',
        password: ' secret ',
        nested: { currentPassword: ' current ' }
    });

    assert.equal(result.nextCalled, true);
    assert.deepEqual(result.req.body, {
        email: 'user@example.com',
        password: ' secret ',
        nested: { currentPassword: ' current ' }
    });
});

test('validateLogin rejects invalid credentials and accepts valid credentials', () => {
    const invalid = runMiddleware(validateLogin, { email: 'bad-email', password: 'short' });
    assert.equal(invalid.nextCalled, false);
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.responseBody.errors.length, 2);

    const valid = runMiddleware(validateLogin, {
        email: 'user@example.com',
        password: ' valid '
    });
    assert.equal(valid.nextCalled, true);
});

test('validateSignup and validateTotp enforce their input requirements', () => {
    const invalidSignup = runMiddleware(validateSignup, {
        email: 'user@example.com',
        password: 'weakpass',
        name: 'A'
    });
    assert.equal(invalidSignup.nextCalled, false);
    assert.equal(invalidSignup.statusCode, 400);

    const validSignup = runMiddleware(validateSignup, {
        email: 'user@example.com',
        password: 'StrongPass1',
        name: 'User',
        mobile: '1234567890'
    });
    assert.equal(validSignup.nextCalled, true);

    const invalidTotp = runMiddleware(validateTotp, { code: '12345' });
    assert.equal(invalidTotp.nextCalled, false);
    assert.equal(invalidTotp.statusCode, 400);

    const validTotp = runMiddleware(validateTotp, { code: '123456' });
    assert.equal(validTotp.nextCalled, true);
    assert.equal(validTotp.req.body.code, '123456');
});
