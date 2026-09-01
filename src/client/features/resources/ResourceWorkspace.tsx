import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, Eye, FilePlus2, LoaderCircle, Pencil, Trash2, X } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, apiBlob, apiMessage, type ApiRow } from "../../api";
import { PageHero } from "../../components/PageHero";
import { getDomain, type FieldConfig, type ResourceConfig } from "./domain-config";

type RelationOptions = Record<string, ApiRow[]>;

function display(value: ApiRow[string] | undefined, format?: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (format === "money" && typeof value === "number") {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(value / 100);
  }
  if (format === "date") {
    const text = String(value);
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    const parsed = dateOnly
      ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
      : new Date(text);
    return Number.isNaN(parsed.valueOf()) ? String(value) : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(parsed);
  }
  if (format === "status") return String(value).replaceAll("_", " ");
  if (format === "boolean") return Number(value) === 1 ? "Yes" : "No";
  return String(value);
}

function formValue(field: FieldConfig, row?: ApiRow): string {
  const value = row?.[field.key];
  if (value === null || value === undefined) return "";
  if (field.type !== "datetime-local") return String(value);
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.valueOf())) return String(value).slice(0, 16);
  return new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

async function fileBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error("The selected file could not be read"));
    reader.onerror = () => reject(reader.error ?? new Error("The selected file could not be read"));
    reader.readAsDataURL(file);
  });
  const separator = dataUrl.indexOf(",");
  if (separator < 0) throw new Error("The selected file could not be encoded");
  return dataUrl.slice(separator + 1);
}

async function cleanupBlobs(blobIds: string[]): Promise<void> {
  const failures: unknown[] = [];
  for (const blobId of blobIds) {
    try {
      await api(`/api/blobs/${blobId}`, { method: "DELETE" });
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, "Uploaded file cleanup failed");
}

async function payload(
  resource: ResourceConfig,
  form: HTMLFormElement
): Promise<{ data: Record<string, unknown>; uploadedBlobIds: string[] }> {
  const data = new FormData(form);
  const result: Record<string, unknown> = {};
  const uploadedBlobIds: string[] = [];
  try {
    for (const field of resource.fields) {
      if (field.type === "checkbox") {
        result[field.key] = data.has(field.key) ? 1 : 0;
        continue;
      }
      if (field.type === "blob") {
        const selected = data.get(field.key);
        if (!(selected instanceof File) || selected.size === 0) continue;
        if (selected.size > 10_000_000) throw new Error("Files must be 10 MB or smaller");
        const uploaded = await api<{ data: ApiRow }>("/api/blobs", {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({
            file_name: selected.name,
            content_type: selected.type || "application/octet-stream",
            data_base64: await fileBase64(selected)
          })
        });
        const blobId = String(uploaded.data.id);
        uploadedBlobIds.push(blobId);
        result[field.key] = blobId;
        continue;
      }
      const raw = String(data.get(field.key) ?? "").trim();
      if (!raw) continue;
      result[field.key] = field.type === "number"
        ? Number(raw)
        : field.type === "datetime-local"
          ? new Date(raw).toISOString()
          : raw;
    }
    return { data: result, uploadedBlobIds };
  } catch (error) {
    try {
      await cleanupBlobs(uploadedBlobIds);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "File upload and cleanup failed");
    }
    throw error;
  }
}

function BlobAction({
  blobId,
  label = "Download file",
  onError
}: {
  blobId: string;
  label?: string;
  onError: (error: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const file = await apiBlob(`/api/blobs/${blobId}`);
      const href = URL.createObjectURL(file);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `hearth-attachment-${blobId}`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className="text-button blob-action" type="button" onClick={() => void download()} disabled={busy}>
      {busy ? <LoaderCircle aria-hidden="true" /> : <Download aria-hidden="true" />}{busy ? "Preparing..." : label}
    </button>
  );
}

function detailValue(field: FieldConfig, row: ApiRow, relations: RelationOptions): string {
  const value = row[field.key];
  if (field.type === "checkbox") return Number(value) === 1 ? "Yes" : "No";
  if (field.relation && value) {
    const option = relations[field.key]?.find((candidate) => String(candidate.id) === String(value));
    if (option) return String(option[field.relation.labelKey] ?? value);
  }
  if (field.type === "json" && typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  if (field.type === "datetime-local" && value) {
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.valueOf())
      ? String(value)
      : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(parsed);
  }
  return display(value, field.type === "date" ? "date" : undefined);
}

async function fetchRelations(resource: ResourceConfig): Promise<RelationOptions> {
  const fields = resource.fields.filter((field) => field.relation);
  const pairs = await Promise.all(fields.map(async (field) => {
    const response = await api<{ data: ApiRow[] }>(field.relation!.path);
    return [field.key, response.data] as const;
  }));
  return Object.fromEntries(pairs);
}

function columnValue(
  resource: ResourceConfig,
  column: ResourceConfig["columns"][number],
  row: ApiRow,
  relations: RelationOptions
): string {
  const field = resource.fields.find((candidate) => candidate.key === column.key);
  const value = row[column.key] ?? (column.fallbackKey ? row[column.fallbackKey] : undefined);
  if (field?.relation && value !== undefined) {
    return detailValue(field, { ...row, [field.key]: value }, relations);
  }
  return display(value, column.format);
}

function attachedBlobIds(resource: ResourceConfig, row: ApiRow): string[] {
  return resource.fields
    .filter((field) => field.type === "blob" && row[field.key])
    .map((field) => String(row[field.key]));
}

function RecordDetailsDialog({
  resource,
  row,
  relations,
  onClose
}: {
  resource: ResourceConfig;
  row: ApiRow;
  relations: RelationOptions;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [blobError, setBlobError] = useState<string | null>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return (
    <dialog
      ref={dialog}
      className="record-dialog record-details-dialog"
      aria-labelledby="record-details-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
    >
      <header className="dialog-heading">
        <div><h2 id="record-details-title">{resource.singular.replace(/\b\w/g, (letter) => letter.toUpperCase())}</h2><span className="folio-label">Complete record</span></div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close record details"><X aria-hidden="true" /></button>
      </header>
      <dl className="record-detail-grid">
        {resource.fields.map((field) => (
          <div className={field.type === "textarea" || field.type === "json" ? "detail-wide" : ""} key={field.key}>
            <dt>{field.label}</dt>
            <dd>
              {field.type === "blob" && row[field.key]
                ? <BlobAction blobId={String(row[field.key])} onError={(error) => setBlobError(apiMessage(error))} />
                : <span className={field.type === "json" ? "json-value" : ""}>{detailValue(field, row, relations)}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {blobError && <div className="inline-error" role="alert"><AlertTriangle aria-hidden="true" />{blobError}</div>}
      <footer className="dialog-actions"><button className="button button-primary" type="button" onClick={onClose}>Close</button></footer>
    </dialog>
  );
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
            <label className={[
              field.type === "textarea" || field.type === "json" || field.type === "blob" ? "field-wide" : "",
              field.type === "checkbox" ? "checkbox-field" : ""
            ].filter(Boolean).join(" ")} key={field.key}>
              <span>{field.label}{field.required && <b aria-hidden="true"> *</b>}</span>
              {field.type === "textarea" || field.type === "json" ? (
                <textarea name={field.key} defaultValue={formValue(field, row)} required={field.required} rows={4} />
              ) : field.type === "checkbox" ? (
                <span className="checkbox-control">
                  <input
                    name={field.key}
                    type="checkbox"
                    defaultChecked={row ? Number(row[field.key] ?? 0) === 1 : field.defaultChecked}
                  />
                  <span>Yes</span>
                </span>
              ) : field.type === "blob" ? (
                <>
                  <input
                    name={field.key}
                    type="file"
                    accept={field.accept}
                    required={field.required && !row?.[field.key]}
                  />
                  {row?.[field.key] && <small>A file is attached. Choose another file only to replace its reference.</small>}
                </>
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
                  type={field.type === "url" ? "url" : field.type ?? "text"}
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
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ApiRow | "new" | null>(null);
  const [viewing, setViewing] = useState<ApiRow | null>(null);
  const [relations, setRelations] = useState<RelationOptions>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = async () => {
    if (!resource) return;
    setState("loading");
    setError(null);
    setActionError(null);
    try {
      const [response, relationRows] = await Promise.all([
        api<{ data: ApiRow[] }>(resource.endpoint),
        fetchRelations(resource)
      ]);
      setRows(response.data);
      setRelations(relationRows);
      setState("ready");
    } catch (loadError) {
      setError(apiMessage(loadError));
      setState("error");
    }
  };

  useEffect(() => {
    setEditing(null);
    setViewing(null);
    void load();
  }, [resource?.endpoint]);

  const openEditor = async (row: ApiRow | "new") => {
    if (!resource) return;
    setSaveError(null);
    try {
      setRelations(await fetchRelations(resource));
      setEditing(row);
    } catch (relationError) {
      setError(apiMessage(relationError));
    }
  };

  const openDetails = async (row: ApiRow) => {
    if (!resource) return;
    try {
      setRelations(await fetchRelations(resource));
      setViewing(row);
    } catch (relationError) {
      setError(apiMessage(relationError));
      setState("error");
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
    let prepared: Awaited<ReturnType<typeof payload>> | undefined;
    const isEdit = editing !== "new" && editing !== null;
    try {
      prepared = await payload(resource, form);
      await api(isEdit ? `${resource.endpoint}/${editing.id}` : resource.endpoint, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(prepared.data)
      });
    } catch (submitError) {
      if (prepared?.uploadedBlobIds.length) {
        try {
          await cleanupBlobs(prepared.uploadedBlobIds);
        } catch (cleanupError) {
          setSaveError(apiMessage(new AggregateError([submitError, cleanupError], "The record was not saved and its uploaded file could not be cleaned up")));
          setSaving(false);
          return;
        }
      }
      setSaveError(apiMessage(submitError));
      setSaving(false);
      return;
    }
    const replacedBlobIds = isEdit
      ? resource.fields
          .filter((field) => field.type === "blob"
            && prepared.data[field.key]
            && editing[field.key]
            && prepared.data[field.key] !== editing[field.key])
          .map((field) => String(editing[field.key]))
      : [];
    setEditing(null);
    await load();
    if (replacedBlobIds.length) {
      try {
        await cleanupBlobs(replacedBlobIds);
      } catch (cleanupError) {
        setActionError(`The record was saved, but its previous attachment was retained. ${apiMessage(cleanupError)}`);
      }
    }
    setSaving(false);
  };

  const remove = async (row: ApiRow) => {
    if (!window.confirm(`Delete this ${resource.singular}? This cannot be undone.`)) return;
    try {
      const blobIds = attachedBlobIds(resource, row);
      await api(`${resource.endpoint}/${row.id}`, {
        method: "DELETE",
        headers: { "Idempotency-Key": crypto.randomUUID() }
      });
      await load();
      if (blobIds.length) {
        try {
          await cleanupBlobs(blobIds);
        } catch (cleanupError) {
          setActionError(`The record was deleted, but its attachment was retained. ${apiMessage(cleanupError)}`);
        }
      }
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

      {actionError && <div className="inline-error workspace-error" role="alert"><AlertTriangle aria-hidden="true" />{actionError}</div>}
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
                        {item.format === "blob" && row[item.key]
                          ? <BlobAction blobId={String(row[item.key])} label="Download" onError={(blobError) => setActionError(apiMessage(blobError))} />
                          : item.format === "status" && row[item.key]
                          ? <span className={`status-mark status-${row[item.key]}`}>{display(row[item.key], item.format)}</span>
                          : columnValue(resource, item, row, relations)}
                      </td>
                    ))}
                    <td className="row-actions">
                      <button className="icon-button" onClick={() => void openDetails(row)} aria-label={`View ${resource.singular}`}><Eye aria-hidden="true" /></button>
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
      {viewing && (
        <RecordDetailsDialog
          resource={resource}
          row={viewing}
          relations={relations}
          onClose={() => setViewing(null)}
        />
      )}
    </main>
  );
}
