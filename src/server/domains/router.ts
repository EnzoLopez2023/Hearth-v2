import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { HearthDatabase } from "../db/database.js";
import { HttpError } from "../http.js";
import { requireMutationRole } from "../auth.js";
import { domainResources, type ResourceDefinition } from "./definitions.js";

type Row = Record<string, unknown>;

function stableId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function parse(definition: ResourceDefinition, body: unknown, update = false): Row {
  const result = (update ? definition.update : definition.create).safeParse(body);
  if (!result.success) {
    throw new HttpError(400, "validation_error", "Request body is invalid", result.error.flatten());
  }
  if (update && Object.keys(result.data).length === 0) {
    throw new HttpError(400, "validation_error", "At least one field is required");
  }
  return result.data;
}

function assertReferences(db: HearthDatabase, householdId: string, definition: ResourceDefinition, data: Row): void {
  for (const reference of definition.references ?? []) {
    if (!(reference.field in data)) continue;
    const value = data[reference.field];
    if (value === null && reference.nullable) continue;
    const found = db.prepare(`SELECT 1 FROM ${reference.table} WHERE id=? AND household_id=?`).get(value, householdId);
    if (!found) throw new HttpError(422, "invalid_reference", `${reference.field} does not belong to this household`);
  }
}

function audit(
  db: HearthDatabase,
  auth: NonNullable<Express.Request["auth"]>,
  requestId: string,
  action: string,
  table: string,
  entityId: string
): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO audit_log(id,household_id,user_id,action,entity_table,entity_id,request_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?)
  `).run(stableId("aud"), auth.householdId, auth.userId, action, table, entityId, requestId, now, now);
}

function mountResource(router: Router, db: HearthDatabase, definition: ResourceDefinition): void {
  const base = `/${definition.path}`;
  router.get(base, (req, res) => {
    const rows = db.prepare(`SELECT * FROM ${definition.table} WHERE household_id=? ORDER BY ${definition.orderBy ?? "created_at DESC"}`)
      .all(req.auth!.householdId);
    res.json({ data: rows });
  });
  router.get(`${base}/:id`, (req, res) => {
    const row = db.prepare(`SELECT * FROM ${definition.table} WHERE id=? AND household_id=?`)
      .get(req.params.id, req.auth!.householdId);
    if (!row) throw new HttpError(404, "not_found", "Record not found");
    res.json({ data: row });
  });
  router.post(base, requireMutationRole, (req, res) => {
    const data = parse(definition, req.body);
    const auth = req.auth!;
    assertReferences(db, auth.householdId, definition, data);
    const id = stableId(definition.idPrefix);
    const now = new Date().toISOString();
    const columns = Object.keys(data);
    db.transaction(() => {
      db.prepare(`INSERT INTO ${definition.table}(id,household_id,created_at,updated_at${columns.length ? `,${columns.join(",")}` : ""})
        VALUES(?,?,?,?${columns.map(() => ",?").join("")})`)
        .run(id, auth.householdId, now, now, ...columns.map((column) => data[column]));
      audit(db, auth, req.requestId, "create", definition.table, id);
    })();
    const row = db.prepare(`SELECT * FROM ${definition.table} WHERE id=?`).get(id);
    res.status(201).json({ data: row });
  });
  router.patch(`${base}/:id`, requireMutationRole, (req, res) => {
    const data = parse(definition, req.body, true);
    const auth = req.auth!;
    assertReferences(db, auth.householdId, definition, data);
    const columns = Object.keys(data);
    const result = db.transaction(() => {
      const updated = db.prepare(`UPDATE ${definition.table} SET ${columns.map((column) => `${column}=?`).join(",")},updated_at=?
        WHERE id=? AND household_id=?`)
        .run(...columns.map((column) => data[column]), new Date().toISOString(), req.params.id, auth.householdId);
      if (updated.changes) audit(db, auth, req.requestId, "update", definition.table, String(req.params.id));
      return updated;
    })();
    if (!result.changes) throw new HttpError(404, "not_found", "Record not found");
    res.json({ data: db.prepare(`SELECT * FROM ${definition.table} WHERE id=? AND household_id=?`).get(req.params.id, auth.householdId) });
  });
  router.delete(`${base}/:id`, requireMutationRole, (req, res) => {
    const auth = req.auth!;
    const result = db.transaction(() => {
      const deleted = db.prepare(`DELETE FROM ${definition.table} WHERE id=? AND household_id=?`)
        .run(req.params.id, auth.householdId);
      if (deleted.changes) audit(db, auth, req.requestId, "delete", definition.table, String(req.params.id));
      return deleted;
    })();
    if (!result.changes) throw new HttpError(404, "not_found", "Record not found");
    res.status(204).send();
  });
}

export function createDomainRouter(db: HearthDatabase, domain: keyof typeof domainResources): Router {
  const router = Router();
  for (const definition of domainResources[domain]!) mountResource(router, db, definition);
  return router;
}
