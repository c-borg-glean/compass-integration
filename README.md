# Compass Integration Middleware

Internal middleware layer that integrates PennyMac's loan origination platform with ICE Mortgage Technology's Compass system.

## Overview

This service handles authentication, loan submissions, rate lock requests, and borrower data synchronization between PennyMac's internal systems and the Compass API. It is the critical integration point for wholesale and correspondent lending channels.

## Architecture

```
Broker Portal / Internal LOS
        │
        ▼
┌──────────────────────────┐
│  Loan Submission Router  │  ← src/middleware/loan-submission.ts
├──────────────────────────┤
│  CompassApiClient        │  ← src/services/compass-api-client.ts
├──────────────────────────┤
│  CompassAuthService      │  ← src/services/compass-auth-service.ts
├──────────────────────────┤
│  Token Validation        │  ← Strict schema check against expected format
└──────────────────────────┘
        │
        ▼
   ICE Compass API
```

## Key Components

- **CompassAuthService** — Handles OAuth token acquisition, validation, and refresh against ICE's authentication service. Performs strict schema validation on tokens before forwarding API requests.
- **CompassApiClient** — Makes authenticated API calls to Compass for loan submissions, rate locks, and borrower data queries.
- **Loan Submission Middleware** — Routes and processes loan submissions from the broker portal through the Compass API pipeline.

## Configuration

Token validation and session settings are managed in `config/channel-integration.json`.

## Known Issues

- **ENG-7234**: ICE's Q1 2026 Compass release (v23.1) changed the OAuth token payload format without notice, breaking our strict token validation. See the Jira ticket for incident history and workaround details.
- Token validation currently uses a hardcoded schema check. A contract testing pipeline is being built to catch vendor API changes before they hit production.

## Related

- Jira: ENG-7234, ENG-6891, ENG-6344
- Confluence: ICE Compass Post-Release Troubleshooting Guide
- ServiceNow: INC0091447
