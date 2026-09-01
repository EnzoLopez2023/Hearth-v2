import { describe, expect, it } from "vitest";
import { z } from "zod";
import { domains } from "../src/client/features/resources/domain-config.js";
import { domainResources } from "../src/server/domains/definitions.js";

describe("domain page coverage", () => {
  it("exposes every generic API resource and field in its page configuration", () => {
    for (const domainName of ["maintenance", "inventory", "yard", "garden", "pool"] as const) {
      const page = domains.find((domain) => domain.slug === domainName);
      expect(page, domainName).toBeDefined();
      for (const definition of domainResources[domainName] ?? []) {
        const resource = page!.resources.find((candidate) => candidate.slug === definition.path);
        expect(resource, `${domainName}/${definition.path}`).toBeDefined();
        expect(definition.create instanceof z.ZodObject).toBe(true);
        if (!(definition.create instanceof z.ZodObject) || !resource) continue;
        const configuredFields = new Set(resource.fields.map((field) => field.key));
        for (const field of Object.keys(definition.create.shape)) {
          expect(configuredFields.has(field), `${domainName}/${definition.path}.${field}`).toBe(true);
        }
        for (const column of resource.columns) {
          expect(
            configuredFields.has(column.key) || Boolean(column.fallbackKey && configuredFields.has(column.fallbackKey)),
            `${domainName}/${definition.path} column ${column.key}`
          ).toBe(true);
        }
      }
    }
  });
});
