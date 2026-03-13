# case-05-stress

## Goal

Demonstrate that Janus evaluation remains deterministic and stable under high event volume.

## Construction

- Generates 1000 deployments: `dep-0001` … `dep-1000`.
- For each deployment, the management log contains a `DEPLOYMENT_COMPLETED` event.
- For 95% of deployments, the log also contains the required `DEPLOYMENT_CONFIRMED` evidence.
- For 5% of deployments, the confirmation evidence is intentionally omitted.

## Deterministic omission pattern

Omissions are introduced deterministically to ensure identical results across runs:

- A deployment is missing confirmation when its numeric id is divisible by 20.
- This yields exactly 50 omissions out of 1000 deployments (5%).

## Expected outcome

- The audit is non-compliant (`NON_COMPLIANT`) because some deployments are missing required evidence.
- The output artifacts are deterministic because:
	- Input logs are deterministic.
	- The evaluator uses a fixed `evaluated_at` timestamp.
	- Evidence ordering is stable.
