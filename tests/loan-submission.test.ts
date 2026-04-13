import { LoanSubmissionMiddleware } from '../src/middleware/loan-submission';
import { CompassApiClient } from '../src/services/compass-api-client';
import { LoanSubmission } from '../src/types/compass-api';

const mockCompassClient = {
  submitLoan: jest.fn(),
  requestRateLock: jest.fn(),
  checkHealth: jest.fn(),
} as unknown as CompassApiClient;

function createTestSubmission(overrides?: Partial<LoanSubmission>): LoanSubmission {
  return {
    loanId: 'LN-2026-00847',
    borrowerId: 'BRW-2026-01234',
    loanAmount: 450000,
    loanType: 'conventional',
    propertyAddress: {
      street: '123 Main St',
      city: 'Westlake Village',
      state: 'CA',
      zip: '91362',
    },
    channel: 'wholesale',
    brokerId: 'BRK-PACIFIC-COAST',
    rateLockRequested: true,
    rateLockDays: 30,
    ...overrides,
  };
}

describe('LoanSubmissionMiddleware', () => {
  let middleware: LoanSubmissionMiddleware;

  beforeEach(() => {
    jest.clearAllMocks();
    middleware = new LoanSubmissionMiddleware(mockCompassClient);
  });

  it('should submit a wholesale loan successfully', async () => {
    (mockCompassClient.submitLoan as jest.Mock).mockResolvedValue({
      submissionId: 'SUB-001',
      loanId: 'LN-2026-00847',
      status: 'accepted',
      compassTrackingId: 'CMP-TRK-001',
      timestamp: '2026-03-24T06:00:00Z',
    });

    (mockCompassClient.requestRateLock as jest.Mock).mockResolvedValue({
      loanId: 'LN-2026-00847',
      lockId: 'LCK-001',
      rate: 6.75,
      lockExpiration: '2026-04-23T06:00:00Z',
      status: 'locked',
    });

    const result = await middleware.processSubmission(createTestSubmission());

    expect(result.status).toBe('accepted');
    expect(mockCompassClient.submitLoan).toHaveBeenCalledTimes(1);
    expect(mockCompassClient.requestRateLock).toHaveBeenCalledTimes(1);
  });

  it('should reject consumer channel submissions', async () => {
    const submission = createTestSubmission({ channel: 'consumer' });

    await expect(middleware.processSubmission(submission)).rejects.toThrow(
      'Consumer channel submissions should route to Vesta'
    );

    expect(mockCompassClient.submitLoan).not.toHaveBeenCalled();
  });

  it('should reject wholesale submissions without brokerId', async () => {
    const submission = createTestSubmission({ brokerId: undefined });

    await expect(middleware.processSubmission(submission)).rejects.toThrow(
      'Wholesale submissions require a brokerId'
    );
  });

  it('should still return submission result if rate lock fails', async () => {
    (mockCompassClient.submitLoan as jest.Mock).mockResolvedValue({
      submissionId: 'SUB-002',
      loanId: 'LN-2026-00847',
      status: 'accepted',
      compassTrackingId: 'CMP-TRK-002',
      timestamp: '2026-03-24T06:00:00Z',
    });

    (mockCompassClient.requestRateLock as jest.Mock).mockRejectedValue(
      new Error('Rate lock service unavailable')
    );

    const result = await middleware.processSubmission(createTestSubmission());

    // Submission succeeded even though rate lock failed
    expect(result.status).toBe('accepted');
  });
});
