/**
 * Expected OAuth token payload from ICE Compass authentication service.
 *
 * IMPORTANT: This schema reflects the token format as of Compass v22.x.
 * ICE has a history of changing token formats in quarterly releases
 * without flagging them as breaking changes. See ENG-7234, ENG-6891.
 *
 * If token validation starts failing after an ICE release, check whether
 * the token payload structure has changed before assuming an internal issue.
 */

export interface CompassTokenPayload {
  /** Subject — the authenticated user/service principal */
  sub: string;

  /** Issuer — should always be ICE's auth service URL */
  iss: string;

  /** Issued at — Unix timestamp */
  iat: number;

  /** Expiration — Unix timestamp */
  exp: number;

  /**
   * Scopes granted to this token.
   * v22.x: space-delimited string, e.g. "loan:submit rate:lock borrower:read"
   * v23.1+: JSON array, e.g. ["loan:submit", "rate:lock", "borrower:read"]
   * Hotfix INC0091447 / ENG-7234: accept both formats.
   */
  scope: string | string[];

  /** PennyMac's partner ID in ICE's system */
  partner_id: string;

  /** Environment — "production" | "staging" | "sandbox" */
  env: string;
}

/** The fields we require to be present on every token */
export const REQUIRED_TOKEN_FIELDS: (keyof CompassTokenPayload)[] = [
  'sub',
  'iss',
  'iat',
  'exp',
  'scope',
  'partner_id',
  'env',
];

/** Valid ICE issuer URLs */
export const VALID_ISSUERS = [
  'https://auth.ice-compass.com',
  'https://auth.staging.ice-compass.com',
];

/** Scopes required for loan submission operations */
export const LOAN_SUBMISSION_SCOPES = ['loan:submit', 'rate:lock'];

/** Scopes required for borrower data read operations */
export const BORROWER_DATA_SCOPES = ['borrower:read'];
