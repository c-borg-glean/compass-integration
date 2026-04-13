import jwt from 'jsonwebtoken';
import { CompassAuthService, CompassAuthError } from '../src/services/compass-auth-service';

/**
 * Tests for CompassAuthService.validateToken()
 *
 * !! IMPORTANT !!
 * These tests only cover the LEGACY token format (Compass v22.x).
 * They do NOT cover the new v23.1 format where:
 *   - `scope` is a JSON array instead of a space-delimited string
 *   - `aud` (audience) claim is present
 *
 * This gap is exactly what caused the 12-hour production outage on
 * 2026-03-24 (INC0091447 / ENG-7234). The tests all passed because
 * they only tested the old format. The new format was never tested.
 *
 * TODO (ENG-7234): Add tests for both token formats and build
 * contract tests that validate against ICE's actual sandbox.
 */

const TEST_SECRET = 'test-secret-key';

function createTestToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, TEST_SECRET);
}

function createValidLegacyPayload(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    sub: 'compass-service-principal',
    iss: 'https://auth.ice-compass.com',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    scope: 'loan:submit rate:lock borrower:read',  // <-- string format (v22.x)
    partner_id: 'PM-ENT-0847',
    env: 'production',
    ...overrides,
  };
}

describe('CompassAuthService', () => {
  let authService: CompassAuthService;

  beforeEach(() => {
    authService = new CompassAuthService('test-client-id', 'test-client-secret');
  });

  describe('validateToken', () => {
    it('should accept a valid legacy format token', () => {
      const token = createTestToken(createValidLegacyPayload());
      const result = authService.validateToken(token);

      expect(result.sub).toBe('compass-service-principal');
      expect(result.scope).toBe('loan:submit rate:lock borrower:read');
      expect(result.partner_id).toBe('PM-ENT-0847');
    });

    it('should reject a token missing required fields', () => {
      const payload = createValidLegacyPayload();
      delete payload.scope;
      const token = createTestToken(payload);

      expect(() => authService.validateToken(token)).toThrow(CompassAuthError);
      expect(() => authService.validateToken(token)).toThrow('missing required field: scope');
    });

    it('should reject a token with an invalid issuer', () => {
      const token = createTestToken(
        createValidLegacyPayload({ iss: 'https://malicious-issuer.com' })
      );

      expect(() => authService.validateToken(token)).toThrow(CompassAuthError);
      expect(() => authService.validateToken(token)).toThrow('unexpected issuer');
    });

    it('should reject an expired token', () => {
      const token = createTestToken(
        createValidLegacyPayload({
          exp: Math.floor(Date.now() / 1000) - 3600,
        })
      );

      expect(() => authService.validateToken(token)).toThrow(CompassAuthError);
      expect(() => authService.validateToken(token)).toThrow('expired');
    });

    it('should reject a token with wrong partner_id', () => {
      const token = createTestToken(
        createValidLegacyPayload({ partner_id: 'WRONG-PARTNER' })
      );

      expect(() => authService.validateToken(token)).toThrow(CompassAuthError);
      expect(() => authService.validateToken(token)).toThrow('partner_id');
    });

    it('should reject a token missing required scopes', () => {
      const token = createTestToken(
        createValidLegacyPayload({ scope: 'borrower:read' })  // missing loan:submit and rate:lock
      );

      expect(() => authService.validateToken(token)).toThrow(CompassAuthError);
      expect(() => authService.validateToken(token)).toThrow('missing required scope');
    });

    it('should reject a token with unknown claims', () => {
      // This test validates the strict schema check that rejects
      // tokens with unexpected claims. In production, ICE added an
      // `aud` claim in v23.1 which triggered this rejection and
      // caused a 12-hour outage. See ENG-7234.
      const token = createTestToken(
        createValidLegacyPayload({ unknown_claim: 'unexpected_value' })
      );

      expect(() => authService.validateToken(token)).toThrow(CompassAuthError);
      expect(() => authService.validateToken(token)).toThrow('unexpected claim');
    });

    // =========================================================
    // MISSING TESTS — These would have caught the v23.1 outage
    // =========================================================
    //
    // TODO: Add test for scope as JSON array format
    //   ICE v23.1 changed scope from:
    //     "loan:submit rate:lock borrower:read"  (string)
    //   to:
    //     ["loan:submit", "rate:lock", "borrower:read"]  (array)
    //
    //   The current validateToken() only handles string format
    //   and throws OAUTH_TOKEN_VALIDATION_FAILED for arrays.
    //
    // TODO: Add test for `aud` (audience) claim
    //   ICE v23.1 added an `aud` claim to the token payload.
    //   The current validateToken() rejects unknown claims,
    //   which means any token with `aud` is rejected.
    //
    // TODO: Add test for mixed old/new format compatibility
    //   During ICE's rollout, some Compass nodes may return
    //   old format tokens and others return new format.
    //   validateToken() should accept both.
    //
    // See ENG-7234 for the full incident report and the
    // contract testing pipeline that will prevent this
    // class of failure going forward.
    // =========================================================
  });
});
