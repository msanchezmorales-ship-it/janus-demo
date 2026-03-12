# Node Demo Runner

This demo provides a small, fully-local Node.js runner for Janus demo cases.

It intentionally stays small and dependency-light to keep the public demo portable and easy to audit.

## What `case-01-happy-path` demonstrates

- Reads append-only input artifacts (NDJSON logs)
- Uses a schema log to declare what evidence is required
- Finds explicit positive evidence (`E+`) in the management log
- Produces an audit result (COMPLIANT) with no omission detected
- Writes deterministic output artifacts (fixed `evaluated_at`)

## What `case-02-omission` demonstrates

This case uses the same schema rule as case-01, but the required confirmation evidence is absent.

- Reads append-only input artifacts (NDJSON logs)
- Uses the schema log to declare what evidence is required
- Emits explicit negative evidence (`E-`) for the missing confirmation
- Marks omission detected and produces a non-compliant audit decision
- Writes deterministic output artifacts (fixed `evaluated_at`)

## What `case-03-human-decision` demonstrates

This case starts the same way as case-02 (missing required evidence), but adds an explicit human authority event that accepts responsibility for the exception.

Important: Janus preserves omission truth — the negative evidence (`E-`) remains in the audit record even when a human accepts the exception.

- Detects omission (`E-`) deterministically
- Detects a linked human decision event for the same deployment
- Records a human-approved exception in the final audit decision

## What `case-04-schema-drift` demonstrates

This case demonstrates schema drift: the event history contains some evidence that used to be sufficient, but a newer schema version requires additional evidence.

Important: Janus treats the inputs as append-only; interpretation changes because the schema changes, not because the history changes.

- Finds explicit positive evidence (`E+`) for requirements that are met
- Emits explicit negative evidence (`E-`) for the new, unmet requirement
- Marks omission detected and produces a non-compliant audit decision
- Records the applied schema version in the audit artifacts and adds a schema-drift note

## Invariants referenced

- Append-only input artifacts
- Schema-governed interpretation
- Explicit positive evidence (`E+`)
- Explicit negative evidence (`E-`)
- Omission detection
- Deterministic rebuildability
- Separation between input evidence and audit output

## Inputs

- Case directory under `../shared/datasets/`

For each case, the runner reads the same filenames:

- `MANAGEMENT_LOG.ndjson`
- `SCHEMA_LOG.ndjson`

## Outputs

- Prints a minimal result object to stdout (schema: `../shared/specs/result-schema.json`)
- Writes artifacts under `./outputs/`:
	- `audit-result.case-01-happy-path.json`
	- `rebuild-summary.case-01-happy-path.json`
	- `audit-result.case-02-omission.json`
	- `rebuild-summary.case-02-omission.json`
	- `audit-result.case-03-human-decision.json`
	- `rebuild-summary.case-03-human-decision.json`
	- `audit-result.case-04-schema-drift.json`
	- `rebuild-summary.case-04-schema-drift.json`

## Run

From the repo root:

- `node demos/node/src/run-demo.js demos/shared/datasets/case-01-happy-path`

Or (case-name form):

- `node demos/node/src/run-demo.js case-01-happy-path`

The output artifacts are written to `demos/node/outputs/`.
