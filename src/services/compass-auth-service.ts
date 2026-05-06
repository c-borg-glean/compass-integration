import jwt from 'jsonwebtoken';
import axios from 'axios';
import { logger } from '../utils/logger';
import {
  CompassTokenPayload,
  REQUIRED_TOKEN_FIELDS,
  VALID_ISSUERS,
} from '../types/compass-token';
import config from '../../config/channel-integration.json';

/**
 * CompassAuthService
 *
 * Handles OAuth token acquisition, validation, and refresh for the
 * ICE Compass loan origination API.
 *
 * KNOWN ISSUE (ENG-7234): This service performs strict schema validation
 * on tokens received from ICE. If ICE changes the token payload format
 * in a quarterly release (which they have done 3 of the last 4 quarters),
 * validation will fail and the entire loan submission pipeline goes down.
 *
 * The current implementation assumes:
 *   - `scope` is always a space-delimited string
 *   - Only known claims are present (no extra fields like `aud`)
 *   - Token structure matches CompassTokenPayload exactly
 *
 * A contract testing pipeline (ENG-7234) is being built to catch these
 * changes before they hit production.
 */
export class CompassAuthService {
  private currentToken: string | null = null;
  private tokenExpiry: number = 0;
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  /**
   * Get a valid token, refreshing if necessary.
   */
  async getToken(): Promise<string> {
    if (this.currentToken && !this.isTokenExpiringSoon()) {
      return this.currentToken;
    }

    return this.refreshToken();
  }

  /**
   * Acquire a new OAuth token from ICE's auth service.
   */
  async refreshToken(): Promise<string> {
    try {
      const response = await axios.post(config.compass.authUrl, {
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope: 'loan:submit rate:lock borrower:read',
      });

      const token = response.data.access_token;

      // Validate the token before accepting it
      this.validateToken(token);

      this.currentToken = token;
      const decoded = jwt.decode(token) as CompassTokenPayload;
      this.tokenExpiry = decoded.exp;

      logger.info('Compass OAuth token refreshed successfully', {
        expiresAt: new Date(decoded.exp * 1000).toISOString(),
        partner_id: decoded.partner_id,
      });

      return token;
    } catch (error) {
      logger.error('Failed to refresh Compass OAuth token', { error });
      throw new CompassAuthError(
        'TOKEN_REFRESH_FAILED',
        'Unable to acquire a valid OAuth token from ICE Compass',
        error
      );
    }
  }

  /**
   * Validate an OAuth token received from ICE Compass.
   *
   * This method performs STRICT schema validation to ensure the token
   * matches our expected format. This is a defensive measure to catch
   * tampered or malformed tokens before they reach the Compass API.
   *
   * !! WARNING !!
   * This strict validation has caused production outages when ICE
   * changes their token format in quarterly releases. See:
   *   - ENG-7234 (v23.1 — scope changed from string to array)
   *   - ENG-6891 (v22.4 — new rate limiting headers)
   *   - ENG-6344 (v22.3 — certificate rotation)
   *
   * If you are seeing OAUTH_TOKEN_VALIDATION_FAILED errors after an
   * ICE release, check the token payload structure FIRST before
   * investigating internal issues.
   */
  validateToken(token: string): CompassTokenPayload {
    const decoded = jwt.decode(token);

    if (!decoded || typeof decoded === 'string') {
      throw new CompassAuthError(
        'TOKEN_DECODE_FAILED',
        'Unable to decode Compass OAuth token'
      );
    }

    const payload = decoded as Record<string, unknown>;

    // --- CHECK 1: Require all expected fields ---
    for (const field of REQUIRED_TOKEN_FIELDS) {
      if (!(field in payload)) {
        throw new CompassAuthError(
          'TOKEN_MISSING_FIELD',
          `Compass OAuth token missing required field: ${field}`
        );
      }
    }

    // --- CHECK 2: Log unknown claims instead of rejecting ---
    // INC0091447 / ENG-7234 (ICE v23.1): ICE added `aud` claim without notice,
    // and the previous strict rejection caused a 12-hour production outage.
    // Now we log unknown claims as warnings instead of throwing.
    const knownFields = new Set<string>([
      ...REQUIRED_TOKEN_FIELDS,
      'jti',  // JWT ID — optional, sometimes present
      'aud',  // Audience — added in ICE v23.1
    ]);

    for (const key of Object.keys(payload)) {
      if (!knownFields.has(key)) {
        logger.warn('Compass OAuth token contains unknown claim — allowing but flagging for review', {
          claim: key,
          hint: 'ICE may have changed the token format in a recent release. See ENG-7234.',
        });
      }
    }

    // --- CHECK 3: Validate issuer ---
    if (!VALID_ISSUERS.includes(payload.iss as string)) {
      throw new CompassAuthError(
        'TOKEN_INVALID_ISSUER',
        `Compass OAuth token has unexpected issuer: ${payload.iss}`
      );
    }

    // --- CHECK 4 & 5: Parse and validate scopes ---
    // INC0091447 / ENG-7234 (ICE v23.1): scope changed from space-delimited
    // string to JSON array. Support both formats for backward compatibility.
    let scopes: string[];
    if (typeof payload.scope === 'string') {
      scopes = payload.scope.split(' ');
    } else if (Array.isArray(payload.scope)) {
      scopes = payload.scope;
    } else {
      throw new CompassAuthError(
        'OAUTH_TOKEN_VALIDATION_FAILED',
        `token schema mismatch — expected scope as string or array, got ${typeof payload.scope}. ` +
        `ICE may have changed the token format in a recent release.`
      );
    }

    const requiredScopes = ['loan:submit', 'rate:lock'];

    for (const required of requiredScopes) {
      if (!scopes.includes(required)) {
        throw new CompassAuthError(
          'TOKEN_INSUFFICIENT_SCOPE',
          `Compass OAuth token missing required scope: ${required}`
        );
      }
    }

    // --- CHECK 6: Validate expiration ---
    const now = Math.floor(Date.now() / 1000);
    if ((payload.exp as number) <= now) {
      throw new CompassAuthError(
        'TOKEN_EXPIRED',
        'Compass OAuth token has expired'
      );
    }

    // --- CHECK 7: Validate partner ID ---
    if (payload.partner_id !== config.compass.partnerId) {
      throw new CompassAuthError(
        'TOKEN_PARTNER_MISMATCH',
        `Token partner_id "${payload.partner_id}" does not match configured partner "${config.compass.partnerId}"`
      );
    }

    logger.debug('Compass OAuth token validated successfully', {
      sub: payload.sub,
      iss: payload.iss,
      scopes,
      partner_id: payload.partner_id,
    });

    return payload as unknown as CompassTokenPayload;
  }

  /**
   * Check if the current token is expiring within the refresh buffer window.
   */
  private isTokenExpiringSoon(): boolean {
    const bufferSeconds = config.compass.session.tokenRefreshBufferMinutes * 60;
    const now = Math.floor(Date.now() / 1000);
    return this.tokenExpiry - now <= bufferSeconds;
  }

  /**
   * Invalidate the current token and force a refresh on next use.
   */
  invalidateToken(): void {
    this.currentToken = null;
    this.tokenExpiry = 0;
    logger.info('Compass OAuth token invalidated');
  }
}

/**
 * Custom error class for Compass authentication failures.
 */
export class CompassAuthError extends Error {
  readonly code: string;
  readonly cause?: unknown;

  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = 'CompassAuthError';
    this.code = code;
    this.cause = cause;
  }
}
