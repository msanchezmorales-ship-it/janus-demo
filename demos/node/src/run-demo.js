/*
  Janus Demo Runner (Node)

  A small, fully-local, deterministic demo runner.

  This is intentionally NOT a full runtime framework.
  It implements only the canonical happy-path case and a tiny evaluation loop.
*/

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const FIXED_EVALUATED_AT = '2026-03-12T00:00:00Z';

function toPosixPath(p) {
  return p.split(path.sep).join('/');
}

function readNdjson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);

  const records = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      records.push(JSON.parse(line));
    } catch (err) {
      const msg = err && typeof err.message === 'string' ? err.message : String(err);
      throw new Error(`Invalid NDJSON in ${filePath} at line ${i + 1}: ${msg}`);
    }
  }
  return { raw, records };
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function resolveCaseDir(arg) {
  const defaultCaseDir = path.resolve(__dirname, '../../shared/datasets/case-01-happy-path');
  if (!arg) return defaultCaseDir;

  const asPath = path.resolve(process.cwd(), arg);
  if (fs.existsSync(asPath)) return asPath;

  // Fall back to interpreting the argument as a case name.
  return path.resolve(__dirname, '../../shared/datasets', arg);
}

function evaluate({ managementRecords, schemaRecords }) {
  const notes = [];
  const evidencePositive = [];
  const evidenceNegative = [];

  const governanceEvents = managementRecords.filter((r) => r && r.type === 'GOVERNANCE_EVENT');
  const evidenceEvents = managementRecords.filter((r) => r && r.type === 'EVIDENCE');

  const schema = schemaRecords.find((r) => r && r.type === 'SCHEMA');
  if (!schema) {
    return {
      schema_applied: null,
      omissionDetected: true,
      auditDecision: 'NON_COMPLIANT',
      evidencePositive,
      evidenceNegative: [
        {
          evidence_id: 'e-schema-missing',
          kind: 'E-',
          reason: 'No schema record found; cannot interpret expected evidence.'
        }
      ],
      notes: ['Schema missing: evaluation cannot be schema-governed.']
    };
  }

  const expects = Array.isArray(schema.expects) ? schema.expects : [];
  if (expects.length === 0) {
    notes.push('Schema contains no expectations; nothing to validate.');
  }

  for (const expectation of expects) {
    const ruleId = expectation.rule_id;
    const whenEventType = expectation.when_event_type;
    const requiresEvidenceType = expectation.requires_evidence_type;
    const matchOn = expectation.match_on;

    for (const evt of governanceEvents) {
      if (!evt || evt.event_type !== whenEventType) continue;

      const matchValue = evt[matchOn];
      const matchingEvidence = evidenceEvents.find(
        (e) =>
          e &&
          e.evidence_type === requiresEvidenceType &&
          e[matchOn] === matchValue
      );

      if (matchingEvidence) {
        evidencePositive.push({
          evidence_id: matchingEvidence.evidence_id || `e+.${ruleId}.${String(matchValue)}`,
          kind: 'E+',
          rule_id: ruleId,
          required_evidence_type: requiresEvidenceType,
          for_event: {
            event_type: evt.event_type,
            match_on: matchOn,
            match_value: matchValue
          },
          from_record: {
            evidence_type: matchingEvidence.evidence_type,
            source: matchingEvidence.source || 'management-log'
          }
        });
      } else {
        evidenceNegative.push({
          evidence_id: `e-.${ruleId}.${String(matchValue)}`,
          kind: 'E-',
          rule_id: ruleId,
          required_evidence_type: requiresEvidenceType,
          reason: `Missing required evidence: ${requiresEvidenceType}`,
          for_event: {
            event_type: evt.event_type,
            match_on: matchOn,
            match_value: matchValue
          }
        });
      }
    }
  }

  evidencePositive.sort((a, b) => String(a.evidence_id).localeCompare(String(b.evidence_id)));
  evidenceNegative.sort((a, b) => String(a.evidence_id).localeCompare(String(b.evidence_id)));

  const omissionDetected = evidenceNegative.length > 0;
  const auditDecision = omissionDetected ? 'NON_COMPLIANT' : 'COMPLIANT';

  const schemaApplied = {
    schema_id: schema.schema_id,
    schema_version: schema.schema_version
  };

  if (omissionDetected && evidencePositive.length > 0) {
    const missingTypes = Array.from(
      new Set(
        evidenceNegative
          .map((e) => e && e.required_evidence_type)
          .filter((t) => typeof t === 'string')
      )
    ).sort();
    if (missingTypes.length > 0 && typeof schemaApplied.schema_version !== 'undefined') {
      notes.push(
        `Schema drift: event history is unchanged, but schema v${schemaApplied.schema_version} requires additional evidence (${missingTypes.join(
          ', '
        )}).`
      );
    }
  }

  return {
    schema_applied: schemaApplied,
    omissionDetected,
    auditDecision,
    evidencePositive,
    evidenceNegative,
    notes
  };
}

function findHumanDecision({ managementRecords, missingMatchValues }) {
  const decisions = managementRecords
    .filter((r) => r && r.type === 'GOVERNANCE_EVENT' && r.event_type === 'GOVERNANCE_EXCEPTION_ACCEPTED')
    .map((r) => ({
      decision_id: r.decision_id,
      authority_type: r.authority_type,
      decision_outcome: r.decision_outcome,
      related_deployment_id: r.related_deployment_id,
      reason: r.reason,
      actor: r.actor,
      ts: r.ts
    }));

  decisions.sort((a, b) => String(a.decision_id || '').localeCompare(String(b.decision_id || '')));

  const linked = decisions.find((d) => missingMatchValues.includes(d.related_deployment_id));
  if (!linked) return { present: false, decision: null };

  return {
    present: true,
    decision: {
      decision_id: linked.decision_id,
      authority_type: linked.authority_type,
      decision_outcome: linked.decision_outcome,
      related_deployment_id: linked.related_deployment_id,
      reason: linked.reason,
      actor: linked.actor,
      ts: linked.ts
    }
  };
}

function main() {
  const caseArg = process.argv[2];
  const caseDir = resolveCaseDir(caseArg);

  if (!fs.existsSync(caseDir) || !fs.statSync(caseDir).isDirectory()) {
    const result = {
      case: path.basename(caseDir),
      demo: 'node',
      invariants: [],
      status: 'FAIL',
      summary: 'Case directory not found or not a directory.'
    };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exitCode = 1;
    return;
  }

  const repoRoot = path.resolve(__dirname, '../../..');
  const caseId = path.basename(caseDir);

  const managementPath = path.join(caseDir, 'MANAGEMENT_LOG.ndjson');
  const schemaPath = path.join(caseDir, 'SCHEMA_LOG.ndjson');

  if (!fs.existsSync(managementPath) || !fs.existsSync(schemaPath)) {
    const result = {
      case: caseId,
      demo: 'node',
      invariants: [],
      status: 'FAIL',
      summary: 'Missing required NDJSON inputs (MANAGEMENT_LOG.ndjson, SCHEMA_LOG.ndjson).'
    };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exitCode = 1;
    return;
  }

  const mgmt = readNdjson(managementPath);
  const schema = readNdjson(schemaPath);

  const inputDigestSha256 = sha256Hex(
    ['MANAGEMENT_LOG.ndjson\n' + mgmt.raw, 'SCHEMA_LOG.ndjson\n' + schema.raw].join('\n')
  );

  const evaluation = evaluate({
    managementRecords: mgmt.records,
    schemaRecords: schema.records
  });

  const missingMatchValues = evaluation.evidenceNegative
    .map((e) => (e && e.for_event ? e.for_event.match_value : null))
    .filter((v) => typeof v === 'string');

  const human = findHumanDecision({
    managementRecords: mgmt.records,
    missingMatchValues
  });

  const invariantsChecked = [
    'append-only input artifacts',
    'schema-governed interpretation',
    ...(evaluation.evidencePositive.length > 0 ? ['explicit positive evidence (E+)'] : []),
    ...(evaluation.evidenceNegative.length > 0 ? ['explicit negative evidence (E-)'] : []),
    ...(evaluation.omissionDetected ? ['omission detection'] : ['no omission detected']),
    ...(human.present
      ? ['explicit human authority event', 'separation between factual omission and final governance decision']
      : []),
    'deterministic rebuildability',
    'separation between input evidence and audit output'
  ];

  const auditDecision = evaluation.omissionDetected
    ? human.present
      ? 'ACCEPTED_WITH_HUMAN_EXCEPTION'
      : 'NON_COMPLIANT'
    : 'COMPLIANT';

  const auditStatus = evaluation.omissionDetected ? (human.present ? 'PASS' : 'FAIL') : 'PASS';

  const outputDir = path.resolve(__dirname, '../outputs');
  const auditOutPath = path.join(outputDir, `audit-result.${caseId}.json`);
  const rebuildOutPath = path.join(outputDir, `rebuild-summary.${caseId}.json`);

  const auditResult = {
    case_id: caseId,
    demo: 'node',
    status: auditStatus,
    evaluated_at: FIXED_EVALUATED_AT,
    schema_applied: evaluation.schema_applied,
    invariants_checked: invariantsChecked,
    evidence_positive: evaluation.evidencePositive,
    evidence_negative: evaluation.evidenceNegative,
    omission_detected: evaluation.omissionDetected,
    human_decision_present: human.present,
    human_decision: human.decision,
    audit_decision: auditDecision,
    notes: [
      'Inputs are treated as append-only artifacts; evaluation does not mutate them.',
      'Schema constrains interpretation: expectations are read only from SCHEMA_LOG.ndjson.',
      ...(human.present
        ? ['Human authority is recorded as an explicit event; it does not erase negative evidence (E-).']
        : []),
      ...evaluation.notes
    ],
    inputs: {
      case_dir: toPosixPath(path.relative(repoRoot, caseDir)),
      management_log: toPosixPath(path.relative(repoRoot, managementPath)),
      schema_log: toPosixPath(path.relative(repoRoot, schemaPath)),
      input_digest_sha256: inputDigestSha256
    }
  };

  const rebuildSummary = {
    case_id: caseId,
    source_files_used: [
      toPosixPath(path.relative(repoRoot, managementPath)),
      toPosixPath(path.relative(repoRoot, schemaPath))
    ],
    event_counts: {
      management_log: mgmt.records.length,
      schema_log: schema.records.length
    },
    deterministic_outcome: true,
    consistency_check: true,
    human_decision_linked: human.present,
    schema_version_applied:
      evaluation.schema_applied && typeof evaluation.schema_applied.schema_version !== 'undefined'
        ? evaluation.schema_applied.schema_version
        : null,
    input_digest_sha256: inputDigestSha256
  };

  writeJson(auditOutPath, auditResult);
  writeJson(rebuildOutPath, rebuildSummary);

  const resultInvariants = [
    'append-only input artifacts',
    'schema-governed interpretation',
    ...(evaluation.evidencePositive.length > 0 ? ['explicit positive evidence (E+)'] : []),
    ...(evaluation.evidenceNegative.length > 0 ? ['explicit negative evidence (E-)'] : []),
    evaluation.omissionDetected ? 'omission detection' : 'no omission detected',
    ...(human.present
      ? ['explicit human authority event', 'separation between factual omission and final governance decision']
      : []),
    'deterministic rebuildability',
    'separation between input evidence and audit output'
  ];

  const result = {
    case: caseId,
    demo: 'node',
    invariants: resultInvariants,
    status: auditStatus,
    summary:
      auditDecision === 'COMPLIANT'
        ? 'Compliant: required evidence found; no omission detected.'
        : auditDecision === 'ACCEPTED_WITH_HUMAN_EXCEPTION'
          ? 'Exception accepted by human authority: omission detected and recorded.'
          : 'Non-compliant: required evidence missing; omission detected.',
    details: {
      evaluated_at: FIXED_EVALUATED_AT,
      audit_decision: auditDecision,
      omission_detected: evaluation.omissionDetected,
      human_decision_present: human.present,
      schema_version_applied:
        evaluation.schema_applied && typeof evaluation.schema_applied.schema_version !== 'undefined'
          ? evaluation.schema_applied.schema_version
          : null,
      outputs: {
        audit_result: toPosixPath(path.relative(repoRoot, auditOutPath)),
        rebuild_summary: toPosixPath(path.relative(repoRoot, rebuildOutPath))
      }
    }
  };

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

main();
