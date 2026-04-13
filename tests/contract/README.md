# Contract Tests — ICE Compass API

**Status**: NOT YET IMPLEMENTED (see ENG-7234)

This directory will contain contract tests that validate PennyMac's
integration assumptions against ICE's actual Compass API specifications.

## Why This Exists

ICE Mortgage Technology has changed their API contract (token format,
response schemas, rate limiting behavior) in 3 of the last 4 quarterly
releases without flagging them as breaking changes. Each time, our
integration middleware broke in production because our code assumed a
fixed contract that ICE silently changed.

## What These Tests Will Do

1. Run nightly against ICE's sandbox environment
2. Validate all OAuth token payload schemas (both string and array scope formats)
3. Validate all 14 API endpoint request/response schemas
4. Alert Platform Engineering immediately if any contract breaks
5. Run as a mandatory gate before accepting any ICE release into production

## Timeline

See ENG-7234 for implementation milestones.

## Incidents This Would Have Prevented

- INC0091447 / ENG-7234 — v23.1 OAuth token format change (12-hour outage)
- INC0089103 / ENG-6891 — v22.4 rate limiting change
- INC0086771 / ENG-6344 — v22.3 certificate rotation
