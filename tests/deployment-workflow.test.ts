import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  classifyProcess,
  parseReport
} from "../scripts/deployment-diagnostic.mjs";
import {
  evaluateMigration,
  evaluateMonitoring,
  evaluateProtectedConfiguration,
  evaluateReadiness,
  evaluateRecovery,
  parseCandidateMigration
} from "../scripts/deployment-precheck.mjs";

const workflow = readFileSync(
  new URL("../.github/workflows/deploy.yml", import.meta.url),
  "utf8"
);
const action = readFileSync(
  new URL("../.github/actions/deployment-diagnostic/action.yml", import.meta.url),
  "utf8"
);
const helper = readFileSync(
  new URL("../scripts/deployment-diagnostic.mjs", import.meta.url)
);
const migrations = readFileSync(
  new URL("../src/server/db/migrations.ts", import.meta.url),
  "utf8"
);

function gitBlobSha(bytes: Buffer): string {
  return createHash("sha1")
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest("hex");
}

function step(name: string): string {
  const marker = `      - name: ${name}\n`;
  const start = workflow.indexOf(marker);
  expect(start, `missing workflow step: ${name}`).toBeGreaterThanOrEqual(0);
  const end = workflow.indexOf("\n      - name:", start + marker.length);
  return workflow.slice(start, end === -1 ? undefined : end);
}

function indexOfOrFail(value: string): number {
  const index = workflow.indexOf(value);
  expect(index, `missing workflow contract: ${value}`).toBeGreaterThanOrEqual(0);
  return index;
}

function readyPayload(version = 4) {
  return {
    status: "ready",
    source_sha: "a".repeat(40),
    checks: {
      database: {
        ok: true,
        authority: {
          path: "/home/data/hearth-v2.db",
          persistent: true
        },
        pragmas: {
          journal_mode: "delete",
          synchronous: "full",
          foreign_keys: true
        },
        integrity: {
          quick_check: "ok"
        },
        schema: {
          migration_version: version,
          expected_migration_version: version
        }
      }
    },
    optional_providers: {
      blob: "azure"
    }
  };
}

describe("deployment-diagnostics-v1 vendoring", () => {
  it("vendors the reviewed helper and action blobs exactly", () => {
    expect(gitBlobSha(helper)).toBe("d31a00faad5832832bf0b91e96387f5f77645700");
    expect(gitBlobSha(Buffer.from(action))).toBe("ff7330e29f4f15abe61bf8c4f5520ff5f1674fc4");
    expect(CONTRACT_VERSION).toBe("deployment-diagnostics-v1");
  });

  it("classifies missing and malformed checker output as execution failure", () => {
    expect(parseReport("trivy-json", "").ok).toBe(false);
    expect(parseReport("trivy-json", "{").ok).toBe(false);
    expect(parseReport("trivy-json", "{}").ok).toBe(false);
    expect(parseReport("spdx-json", "{}").ok).toBe(false);
    expect(parseReport("cyclonedx-json", "{}").ok).toBe(false);
    expect(classifyProcess({ spawnError: "ENOENT", timedOut: false, signal: null, exitCode: null }).ok)
      .toBe(false);
    expect(classifyProcess({ spawnError: null, timedOut: true, signal: "SIGKILL", exitCode: null }).ok)
      .toBe(false);
  });

  it("emits warnings, summary rows, and JSONL records for non-pass results", () => {
    const source = helper.toString("utf8");
    expect(source).toContain("::${level} title=${escapedTitle}::${escaped}");
    expect(source).toContain("appendStepSummary(");
    expect(source).toContain("appendFileSync(absolute, `${JSON.stringify(record)}\\n`)");
    expect(source).toContain("non-blocking; deferred remediation for the next build or release");
  });
});

describe("production deployment workflow", () => {
  it("invokes every applicable diagnostic through the vendored action", () => {
    const checkIds = [
      "source-dependency-audit",
      "source-sbom",
      "image-sbom",
      "image-vulnerability-scan",
      "signature-verification",
      "provenance-attestation-verification",
      "migration-compatibility-precheck",
      "recovery-precondition-precheck",
      "readiness-precondition-precheck",
      "monitoring-precheck",
      "protected-configuration-precheck"
    ];
    for (const checkId of checkIds) {
      expect(workflow.match(new RegExp(`check-id: ${checkId}`, "g"))).toHaveLength(1);
    }
    expect(workflow.match(/uses: \.\/\.github\/actions\/deployment-diagnostic/g))
      .toHaveLength(checkIds.length + 1);
    expect(workflow).not.toMatch(/\n\s+needs:/);
  });

  it("keeps scanner versions, exact-image inputs, and detection strength", () => {
    const sbom = step("Generate exact-image SPDX SBOM");
    expect(sbom).toContain(
      "anchore/sbom-action@e22c389904149dbc22b58101806040fa8d37a610"
    );
    expect(sbom).toContain("image: ${{ steps.image.outputs.image }}");
    expect(sbom).toContain("format: spdx-json");
    expect(sbom).toContain("upload-artifact: false");
    expect(sbom).toContain("continue-on-error: true");

    const scan = step("Scan exact image for HIGH and CRITICAL vulnerabilities");
    expect(scan).toContain(
      "aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25"
    );
    expect(scan).toContain("image-ref: ${{ steps.image.outputs.image }}");
    expect(scan).toContain("severity: HIGH,CRITICAL");
    expect(scan).toContain("ignore-unfixed: false");
    expect(scan).toContain("scanners: vuln");
    expect(scan).toContain("timeout: 10m");
    expect(scan).toContain("exit-code: '0'");
    expect(scan).toContain("continue-on-error: true");

    const cosign = step("Install Cosign for diagnostic verification");
    expect(cosign).toContain(
      "sigstore/cosign-installer@6f9f17788090df1f26f669e9d70d6ae9567deba6"
    );
    expect(cosign).toContain("continue-on-error: true");
    expect(workflow).toContain("--type slsaprovenance1");
    expect(workflow).toContain("--type spdxjson");
    expect(workflow).not.toMatch(/\.trivyignore|--ignorefile|insecure-ignore-tlog/);
  });

  it("keeps required operations, canary verification, rollback, and promotion blocking", () => {
    for (const name of [
      "Checkout exact source",
      "Set up Node",
      "Install exact dependencies",
      "Run release build",
      "Azure login with OIDC",
      "Build and push immutable image",
      "Pin exact digest and verify",
      "Restore prior image after failed activation",
      "Promote verified digest"
    ]) {
      expect(step(name)).not.toContain("continue-on-error:");
    }

    const image = step("Build and push immutable image");
    expect(image).toContain("docker buildx build");
    expect(image).toContain("--push");
    expect(image).toContain("az acr manifest show-metadata");
    expect(image).toContain('[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]');

    const activation = step("Pin exact digest and verify");
    expect(activation).toContain("az webapp config container set");
    expect(activation).toContain('.status == "live"');
    expect(activation).toContain('.status == "ready"');
    expect(activation).toContain("exit 1");

    const rollback = step("Restore prior image after failed activation");
    expect(rollback).toContain("failure()");
    expect(rollback).toContain("steps.deploy.outputs.prior_image");
    expect(rollback).toContain("az webapp config container set");

    const promotion = step("Promote verified digest");
    expect(promotion).toContain("if: ${{ success() }}");
    expect(promotion).toContain('[[ "$promoted_digest" == "$digest" ]]');
  });

  it("runs diagnostics in phase without making them deployment dependencies", () => {
    expect(indexOfOrFail("check-id: source-dependency-audit"))
      .toBeLessThan(indexOfOrFail("- name: Run release build"));
    expect(indexOfOrFail("- name: Azure login with OIDC"))
      .toBeLessThan(indexOfOrFail("check-id: migration-compatibility-precheck"));
    expect(indexOfOrFail("check-id: protected-configuration-precheck"))
      .toBeLessThan(indexOfOrFail("- name: Build and push immutable image"));
    expect(indexOfOrFail("- name: Build and push immutable image"))
      .toBeLessThan(indexOfOrFail("check-id: image-sbom"));
    expect(indexOfOrFail("check-id: provenance-attestation-verification"))
      .toBeLessThan(indexOfOrFail("- name: Pin exact digest and verify"));
  });

  it("aggregates and uploads retained evidence best-effort with loud warnings", () => {
    const aggregate = step("Aggregate deployment diagnostics");
    expect(aggregate).toContain("if: ${{ always() }}");
    expect(aggregate).toContain("continue-on-error: true");
    expect(aggregate).toContain("mode: aggregate");

    const upload = step("Upload deployment diagnostic evidence");
    expect(upload).toContain("if: ${{ always() }}");
    expect(upload).toContain("continue-on-error: true");
    expect(upload).toContain(
      "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02"
    );
    expect(upload).toContain("deployment-diagnostics/records.jsonl");
    expect(upload).toContain("deployment-diagnostics/records-summary.json");
    expect(upload).toContain("retention-days: 30");
    expect(step("Warn if diagnostic aggregation failed")).toContain("::warning");
    expect(step("Warn if diagnostic evidence upload failed")).toContain("::warning");
  });

  it("pins every remote action to an immutable commit", () => {
    const remoteUses = [...workflow.matchAll(/^\s+uses:\s+([^.\s][^\s#]*)/gm)]
      .map((match) => match[1]);
    expect(remoteUses.length).toBeGreaterThan(0);
    for (const use of remoteUses) {
      expect(use).toMatch(/@[0-9a-f]{40}$/);
    }
  });
});

describe("Hearth deployment prechecks", () => {
  it("evaluates migration direction and rejects malformed readiness evidence", () => {
    const candidate = parseCandidateMigration(migrations);
    expect(candidate.version).toBeGreaterThan(0);
    expect(evaluateMigration(readyPayload(candidate.version), candidate).ok).toBe(true);
    expect(
      evaluateMigration(readyPayload(candidate.version + 1), candidate).ok
    ).toBe(false);
    expect(() => evaluateMigration({}, candidate)).toThrow(/missing or malformed/);
  });

  it("distinguishes readiness from the unresolved recovery freshness finding", () => {
    expect(evaluateReadiness(readyPayload()).ok).toBe(true);
    const recovery = evaluateRecovery(readyPayload());
    expect(recovery.ok).toBe(false);
    expect(recovery.off_host_backup_freshness).toBe("not-observable");
    expect(recovery.detail).toMatch(/backup freshness signal/);
  });

  it("requires target-scoped enabled monitoring with an action group", () => {
    const webappId = "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Web/sites/app-hearth-v2-prod";
    const alert = {
      name: "hearth-v2 availability",
      enabled: true,
      scopes: [webappId],
      actions: [{ actionGroupId: "/subscriptions/sub/actionGroups/owner" }]
    };
    expect(evaluateMonitoring([alert], [], webappId, "app-hearth-v2-prod").ok).toBe(true);
    expect(evaluateMonitoring([], [], webappId, "app-hearth-v2-prod").ok).toBe(false);
  });

  it("compares setting names and safe site invariants without retaining values", () => {
    const names = [
      "AZURE_STORAGE_ACCOUNT_URL",
      "BLOB_PROVIDER",
      "ENTRA_API_SCOPE",
      "ENTRA_CLIENT_ID",
      "ENTRA_TENANT_ID",
      "NODE_ENV",
      "OIDC_AUDIENCE",
      "OIDC_ISSUER",
      "OIDC_JWKS_URI"
    ];
    const site = {
      alwaysOn: true,
      numberOfWorkers: 1,
      healthCheckPath: "/api/live",
      acrUseManagedIdentityCreds: true,
      linuxFxVersion: `DOCKER|registry.azurecr.io/hearth-v2@sha256:${"a".repeat(64)}`
    };
    const result = evaluateProtectedConfiguration(
      names,
      site,
      "registry.azurecr.io/hearth-v2"
    );
    expect(result.ok).toBe(true);
    expect(result).not.toHaveProperty("setting_values");
    expect(evaluateProtectedConfiguration(names.slice(1), site, "registry.azurecr.io/hearth-v2").ok)
      .toBe(false);
  });
});
