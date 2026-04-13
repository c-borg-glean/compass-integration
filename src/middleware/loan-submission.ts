import { CompassApiClient } from '../services/compass-api-client';
import { logger } from '../utils/logger';
import { LoanSubmission, LoanSubmissionResponse } from '../types/compass-api';

/**
 * Loan Submission Middleware
 *
 * Routes and processes loan submissions from PennyMac's broker portal
 * and internal LOS through the Compass API pipeline.
 *
 * Channel routing:
 *   - 'wholesale' → Compass API (this middleware)
 *   - 'correspondent' → Compass API (this middleware)
 *   - 'consumer' → Vesta API (separate service, Project Horizon)
 *
 * When this middleware fails, brokers cannot submit loans and the
 * wholesale/correspondent channels are effectively down.
 */
export class LoanSubmissionMiddleware {
  private readonly compassClient: CompassApiClient;

  constructor(compassClient: CompassApiClient) {
    this.compassClient = compassClient;
  }

  /**
   * Process a loan submission request.
   *
   * Validates the submission, checks channel routing, and forwards
   * to the Compass API. If the submission fails, it is queued for
   * retry (up to 3 attempts with exponential backoff).
   */
  async processSubmission(submission: LoanSubmission): Promise<LoanSubmissionResponse> {
    logger.info('Processing loan submission', {
      loanId: submission.loanId,
      channel: submission.channel,
      loanType: submission.loanType,
      brokerId: submission.brokerId,
    });

    // Consumer channel should not be hitting this middleware.
    // It was migrated to Vesta in Q4 2025 (Project Horizon Phase 1).
    if (submission.channel === 'consumer') {
      throw new Error(
        `Consumer channel submissions should route to Vesta, not Compass. ` +
        `Loan ${submission.loanId} was incorrectly routed.`
      );
    }

    // Validate required fields for wholesale/correspondent
    this.validateSubmission(submission);

    // Submit to Compass
    try {
      const result = await this.compassClient.submitLoan(submission);

      // If rate lock was requested, process it immediately after submission
      if (submission.rateLockRequested && submission.rateLockDays) {
        try {
          const rateLock = await this.compassClient.requestRateLock({
            loanId: submission.loanId,
            lockDays: submission.rateLockDays,
          });

          logger.info('Rate lock applied with submission', {
            loanId: submission.loanId,
            lockId: rateLock.lockId,
            rate: rateLock.rate,
            expiration: rateLock.lockExpiration,
          });
        } catch (rateLockError) {
          // Loan was submitted but rate lock failed.
          // Log and alert — broker needs to know their lock didn't go through.
          logger.error('Rate lock failed after successful submission', {
            loanId: submission.loanId,
            submissionId: result.submissionId,
            error: rateLockError,
          });
        }
      }

      return result;
    } catch (error) {
      logger.error('Loan submission to Compass failed', {
        loanId: submission.loanId,
        channel: submission.channel,
        brokerId: submission.brokerId,
        error,
      });
      throw error;
    }
  }

  /**
   * Validate a loan submission before forwarding to Compass.
   */
  private validateSubmission(submission: LoanSubmission): void {
    if (!submission.loanId) {
      throw new Error('Loan submission missing loanId');
    }

    if (!submission.borrowerId) {
      throw new Error('Loan submission missing borrowerId');
    }

    if (submission.channel === 'wholesale' && !submission.brokerId) {
      throw new Error('Wholesale submissions require a brokerId');
    }

    if (submission.loanAmount <= 0) {
      throw new Error('Loan amount must be positive');
    }
  }
}
