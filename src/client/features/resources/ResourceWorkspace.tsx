import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, FilePlus2, Pencil, Trash2, X } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, apiMessage, type ApiRow } from "../../api";
import { PageHero } from "../../components/PageHero";
import { getDomain, type FieldConfig, type ResourceConfig } from "./domain-config";

type RelationOptions = Record<string, ApiRow[]>;

function display(value: ApiRow[string] | undefined, format?: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (format === "money" && typeof value === "number") {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(value / 100);
  }
  if (format === "date") {
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.valueOf()) ? String(value) : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(parsed);
  }
  if (format === "status") return String(value).replaceAll("_", " ");
  return String(value);
}

function formValue(field: FieldConfig, row?: ApiRow): string {
  const value = row?.[field.key];
  if (value === null || value === undefined) return "";
  return field.type === "datetime-local" ? String(value).slice(0, 16) : String(value);
}

function payload(resource: ResourceConfig, form: HTMLFormElement): Record<string, unknown> {
  const data = new FormData(form);
  const result: Record<string, unknown> = {};
  for (const field of resource.fields) {
    const raw = String(data.get(field.key) ?? "").trim();
    if (!raw) continue;
    result[field.key] = field.type === "number"
      ? Number(raw)
      : field.type === "datetime-local"
        ? new Date(raw).toISOString()
        : raw;
  }
  return result;
}

function RecordDialog({
  resource,
  row,
  relations,
  busy,
  error,
  onClose,
  onSubmit
}: {
  resource: ResourceConfig;
  row: ApiRow | undefined;
  relations: RelationOptions;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (form: HTMLFormElement) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);

  return (
    <dialog ref={dialog} className="record-dialog" onCancel={onClose} onClose={onClose}>
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(event.currentTarget);
        }}
      >
        <header className="dialog-heading">
          <div>
            <h2>{row ? `Edit ${resource.singular}` : `Add ${resource.singular}`}</h2>
            <span className="folio-label">{row ? "Revise entry" : "New field entry"}</span>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close form">
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="form-grid">
          {resource.fields.map((field) => (
            <label className={field.type === "textarea" ? "field-wide" : ""} key={field.key}>
              <span>{field.label}{field.required && <b aria-hidden="true"> *</b>}</span>
              {field.type === "textarea" ? (
                <textarea name={field.key} defaultValue={formValue(field, row)} required={field.required} rows={4} />
              ) : field.type === "select" ? (
                <select name={field.key} defaultValue={formValue(field, row)} required={field.required}>
                  <option value="">Not set</option>
                  {(field.relation
                    ? relations[field.key]?.map((option) => ({
                        value: String(option.id),
                        label: String(option[field.relation!.labelKey] ?? option.id)
                      })) ?? []
                    : field.options?.map((option) => ({ value: option, label: option.replaceAll("_", " ") })) ?? []
                  ).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              ) : (
                <input
                  name={field.key}
                  type={field.type ?? "text"}
                  defaultValue={formValue(field, row)}
                  required={field.required}
                  step={field.step}
                />
              )}
              {field.help && <small>{field.help}</small>}
            </label>
          ))}
        </div>
        {error && <div className="inline-error" role="alert"><AlertTriangle aria-hidden="true" />{error}</div>}
        <footer className="dialog-actions">
          <button className="button button-quiet" type="button" onClick={onClose}>Cancel</button>
          <button className="button button-primary" type="submit" disabled={busy}>
            {busy ? "Recording…" : row ? "Save revision" : "Record entry"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

export function ResourceWorkspace() {
  const { domain: domainSlug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const domain = getDomain(domainSlug);
  const resource = useMemo(
    () => domain?.resources.find((entry) => entry.slug === searchParams.get("ledger")) ?? domain?.resources[0],
    [domain, searchParams]
  );
  const [rows, setRows] = useState<ApiRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ApiRow | "new" | null>(null);
  const [relations, setRelations] = useState<RelationOptions>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = async () => {
    if (!resource) return;
    setState("loading");
    setError(null);
    try {
      const response = await api<{ data: ApiRow[] }>(resource.endpoint);
      setRows(response.data);
      setState("ready");
    } catch (loadError) {
      setError(apiMessage(loadError));
      setState("error");
    }
  };

  useEffect(() => { void load(); }, [resource?.endpoint]);

  const openEditor = async (row: ApiRow | "new") => {
    if (!resource) return;
    setSaveError(null);
    try {
      const fields = resource.fields.filter((field) => field.relation);
      const pairs = await Promise.all(fields.map(async (field) => {
        const response = await api<{ data: ApiRow[] }>(field.relation!.path);
        return [field.key, response.data] as const;
      }));
      setRelations(Object.fromEntries(pairs));
      setEditing(row);
    } catch (relationError) {
      setError(apiMessage(relationError));
    }
  };

  if (!domain || !resource) {
    return (
      <main className="work-field missing-page">
        <span className="folio-label">Uncharted folio</span>
        <h1>This property section does not exist.</h1>
        <Link className="button button-primary" to="/">Return to today</Link>
      </main>
    );
  }

  const submit = async (form: HTMLFormElement) => {
    setSaving(true);
    setSaveError(null);
    try {
      const isEdit = editing !== "new" && editing !== null;
      await api(isEdit ? `${resource.endpoint}/${editing.id}` : resource.endpoint, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(payload(resource, form))
      });
      setEditing(null);
      await load();
    } catch (submitError) {
      setSaveError(apiMessage(submitError));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: ApiRow) => {
    if (!window.confirm(`Delete this ${resource.singular}? This cannot be undone.`)) return;
    try {
      await api(`${resource.endpoint}/${row.id}`, {
        method: "DELETE",
        headers: { "Idempotency-Key": crypto.randomUUID() }
      });
      await load();
    } catch (deleteError) {
      setError(apiMessage(deleteError));
      setState("error");
    }
  };

  return (
    <main className="work-field">
      <PageHero
        eyebrow={domain.label}
        title={domain.heroTitle}
        accentPhrase={domain.heroAccent}
        subtitle={domain.description}
        variant={domain.slug === "pool" ? "pool" : "default"}
        stats={domain.slug === "pool" ? [
          { label: "current ledger", value: resource.label },
          { label: "entries", value: state === "loading" ? "—" : rows.length }
        ] : undefined}
        actions={
          <button className="button button-primary" onClick={() => void openEditor("new")}>
            <FilePlus2 aria-hidden="true" /> Record {resource.singular}
          </button>
        }
      />

      <nav className="ledger-tabs" aria-label={`${domain.label} ledgers`}>
        {domain.resources.map((entry) => (
          <button
            key={entry.slug}
            aria-current={entry.slug === resource.slug ? "page" : undefined}
            onClick={() => setSearchParams({ ledger: entry.slug })}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <h2 className="section-label">Current ledger</h2>
      <section className="ledger-sheet" aria-labelledby="ledger-title">
        <header className="ledger-heading">
          <div><h2 id="ledger-title">{resource.label}</h2><span className="ledger-subtitle">{domain.coordinate} · Household record</span></div>
          <span className="entry-count">{rows.length} {rows.length === 1 ? "entry" : "entries"}</span>
        </header>
        {state === "loading" && <div className="skeleton-ledger" aria-label="Loading ledger"><i /><i /><i /><i /></div>}
        {state === "error" && (
          <div className="state-panel state-error" role="alert">
            <AlertTriangle aria-hidden="true" />
            <div><h3>Ledger unavailable</h3><p>{error}</p><button className="text-button" onClick={() => void load()}>Try again</button></div>
          </div>
        )}
        {state === "ready" && rows.length === 0 && (
          <div className="state-panel state-empty">
            <FilePlus2 aria-hidden="true" />
            <div>
              <h3>Open the {resource.label.toLowerCase()}</h3>
              <p>There are no fabricated records here. Add the first real {resource.singular} when you are ready.</p>
              <button className="text-button" onClick={() => void openEditor("new")}>Record the first entry</button>
            </div>
          </div>
        )}
        {state === "ready" && rows.length > 0 && (
          <div className="table-scroll">
            <table>
              <thead><tr>{resource.columns.map((item) => <th key={item.key}>{item.label}</th>)}<th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={String(row.id)}>
                    {resource.columns.map((item) => (
                      <td key={item.key} data-label={item.label}>
                        {item.format === "status" && row[item.key]
                          ? <span className={`status-mark status-${row[item.key]}`}>{display(row[item.key], item.format)}</span>
                          : display(row[item.key], item.format)}
                      </td>
                    ))}
                    <td className="row-actions">
                      <button className="icon-button" onClick={() => void openEditor(row)} aria-label={`Edit ${resource.singular}`}><Pencil aria-hidden="true" /></button>
                      <button className="icon-button danger" onClick={() => void remove(row)} aria-label={`Delete ${resource.singular}`}><Trash2 aria-hidden="true" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <RecordDialog
          resource={resource}
          row={editing === "new" ? undefined : editing}
          relations={relations}
          busy={saving}
          error={saveError}
          onClose={() => setEditing(null)}
          onSubmit={(form) => void submit(form)}
        />
      )}
    </main>
  );
}
