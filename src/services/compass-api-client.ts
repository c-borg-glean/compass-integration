import axios, { AxiosInstance, AxiosError } from 'axios';
import { CompassAuthService, CompassAuthError } from './compass-auth-service';
import { logger } from '../utils/logger';
import {
  LoanSubmission,
  LoanSubmissionResponse,
  RateLockRequest,
  RateLockResponse,
  CompassHealthResponse,
  CompassApiError,
} from '../types/compass-api';
import config from '../../config/channel-integration.json';

/**
 * CompassApiClient
 *
 * Makes authenticated API calls to the ICE Compass loan origination platform.
 * All requests go through CompassAuthService for token management.
 *
 * Channels served:
 *   - Wholesale (broker submissions)
 *   - Correspondent (lender submissions)
 *   - Consumer channel has migrated to Vesta and does NOT use this client.
 */
export class CompassApiClient {
  private readonly httpClient: AxiosInstance;
  private readonly authService: CompassAuthService;

  constructor(authService: CompassAuthService) {
    this.authService = authService;
    // INC-XXXX: ICE Compass v23.2 requires X-API-Version header on all requests.
    // Without it, all submissions return 503. Value is config-driven via
    // channel-integration.json "apiVersion" field.
    this.httpClient = axios.create({
      baseURL: config.compass.apiBaseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'X-Partner-Id': config.compass.partnerId,
        ...(config.compass.apiVersion && { 'X-API-Version': config.compass.apiVersion }),
      },
    });
  }

  /**
   * Submit a loan to Compass for processing.
   *
   * This is the primary submission endpoint used by wholesale and
   * correspondent channels. When this fails, brokers cannot submit
   * loans and revenue stops.
   */
  async submitLoan(submission: LoanSubmission): Promise<LoanSubmissionResponse> {
    const token = await this.authService.getToken();

    try {
      const response = await this.httpClient.post<LoanSubmissionResponse>(
        '/loans/submit',
        submission,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      logger.info('Loan submitted to Compass successfully', {
        loanId: submission.loanId,
        channel: submission.channel,
        compassTrackingId: response.data.compassTrackingId,
      });

      return response.data;
    } catch (error) {
      return this.handleApiError('submitLoan', submission.loanId, error);
    }
  }

  /**
   * Request a rate lock for a loan.
   *
   * Rate locks are time-sensitive — brokers commit to borrowers based
   * on locked rates. If this endpoint is down, rate locks expire and
   * brokers lose money or route to competitors.
   */
  async requestRateLock(request: RateLockRequest): Promise<RateLockResponse> {
    const token = await this.authService.getToken();

    try {
      const response = await this.httpClient.post<RateLockResponse>(
        '/loans/rate-lock',
        request,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      logger.info('Rate lock requested successfully', {
        loanId: request.loanId,
        lockId: response.data.lockId,
        rate: response.data.rate,
        expiration: response.data.lockExpiration,
      });

      return response.data;
    } catch (error) {
      return this.handleApiError('requestRateLock', request.loanId, error);
    }
  }

  /**
   * Check Compass API health status.
   * Used by the health check job (runs every 5 min) to detect outages.
   */
  async checkHealth(): Promise<CompassHealthResponse> {
    try {
      const response = await this.httpClient.get<CompassHealthResponse>(
        config.compass.healthCheck.endpoint,
        { timeout: config.compass.healthCheck.timeoutMs }
      );
      return response.data;
    } catch (error) {
      logger.warn('Compass health check failed', { error });
      return {
        status: 'down',
        version: 'unknown',
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Handle API errors with structured logging and error classification.
   */
  private handleApiError(operation: string, loanId: string, error: unknown): never {
    if (error instanceof CompassAuthError) {
      logger.error('Compass auth error during API call', {
        operation,
        loanId,
        errorCode: error.code,
        message: error.message,
      });
      throw error;
    }

    if (error instanceof AxiosError) {
      const apiError = error.response?.data as CompassApiError | undefined;

      logger.error('Compass API error', {
        operation,
        loanId,
        httpStatus: error.response?.status,
        errorCode: apiError?.code,
        message: apiError?.message,
        compassRequestId: apiError?.compassRequestId,
      });

      // If we get a 401, the token may have been invalidated server-side.
      // Force a refresh on the next call.
      if (error.response?.status === 401) {
        this.authService.invalidateToken();
      }

      throw new Error(
        `Compass API error in ${operation}: ${apiError?.code || 'UNKNOWN'} — ${apiError?.message || error.message}`
      );
    }

    throw error;
  }
}
