# Case 04 — Schema Drift

This case demonstrates schema drift / historical reinterpretation.

## Core idea

Event history stays the same.
Schema expectations change.
Therefore the audit outcome can change.

## Inputs

- `MANAGEMENT_LOG.ndjson`
	- Contains a `DEPLOYMENT_COMPLETED` governance event.
	- Contains confirmation evidence (`DEPLOYMENT_CONFIRMED`) that would satisfy an earlier schema.
- `SCHEMA_LOG.ndjson`
	- Uses a newer `schema_version` and adds an additional requirement:
		`POST_DEPLOYMENT_REVIEW_APPROVED`.

## Expected outcome

- Positive evidence exists for the historical confirmation.
- Negative evidence (`E-`) is emitted for the newly required missing evidence.
- `omission_detected: true` under the newer schema.
