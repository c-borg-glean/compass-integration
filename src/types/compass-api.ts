export interface LoanSubmission {
  loanId: string;
  borrowerId: string;
  loanAmount: number;
  loanType: 'conventional' | 'fha' | 'va' | 'jumbo';
  propertyAddress: PropertyAddress;
  channel: 'wholesale' | 'correspondent' | 'consumer';
  brokerId?: string;
  rateLockRequested: boolean;
  rateLockDays?: 15 | 30 | 45 | 60;
}

export interface PropertyAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface RateLockRequest {
  loanId: string;
  lockDays: 15 | 30 | 45 | 60;
  requestedRate?: number;
}

export interface RateLockResponse {
  loanId: string;
  lockId: string;
  rate: number;
  lockExpiration: string;
  status: 'locked' | 'expired' | 'pending';
}

export interface LoanSubmissionResponse {
  submissionId: string;
  loanId: string;
  status: 'accepted' | 'queued' | 'rejected';
  compassTrackingId: string;
  timestamp: string;
}

export interface CompassHealthResponse {
  status: 'healthy' | 'degraded' | 'down';
  version: string;
  timestamp: string;
}

export interface CompassApiError {
  code: string;
  message: string;
  details?: string;
  compassRequestId?: string;
}
