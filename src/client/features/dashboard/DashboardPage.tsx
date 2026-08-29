import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight, Check, ClipboardPlus, MapPin, Plus, Sprout, Wrench } from "lucide-react";
import { Link } from "react-router-dom";
import { api, apiMessage, type ApiRow } from "../../api";

interface Dashboard {
  as_of: string;
  first_run: boolean;
  empty_message: string | null;
  attention: Record<string, ApiRow[]>;
  context: { shopping: ApiRow[]; recent_recipes: ApiRow[] };
  counts: Record<string, number>;
}

const labels: Record<string, string> = {
  maintenance: "Maintenance",
  inventory: "Inventory",
  warranties: "Warranties",
  yard: "Yard",
  garden: "Garden",
  pool_readings: "Pool readings",
  pool_recommendations: "Pool actions"
};

function itemTitle(item: ApiRow): string {
  return String(item.title ?? item.name ?? item.metric ?? "Property entry");
}

function itemMeta(item: ApiRow): string {
  const parts = [item.due_on, item.expires_on, item.priority, item.status].filter(Boolean);
  return parts.map(String).join(" · ") || "Recorded evidence";
}

export function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api<{ data: Dashboard }>("/api/dashboard");
      setData(response.data);
    } catch (loadError) {
      setError(apiMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const attention = useMemo(
    () => data ? Object.entries(data.attention).flatMap(([kind, items]) => items.map((item) => ({ kind, item }))) : [],
    [data]
  );

  return (
    <main className="work-field today-field">
      <header className="surface-heading today-heading">
        <div>
          <h1>Today on the property</h1>
          <span className="folio-label">Folio T–00 · {data?.as_of ?? "Today"}</span>
          <p>Work that is due, evidence that needs review, and the shortest path to the next useful record.</p>
        </div>
        <Link className="button button-primary" to="/maintenance?ledger=tasks"><ClipboardPlus aria-hidden="true" /> Log property work</Link>
      </header>

      {loading && <div className="today-layout"><div className="skeleton-field" /><div className="skeleton-field narrow" /></div>}
      {error && (
        <div className="state-panel state-error" role="alert">
          <AlertTriangle aria-hidden="true" />
          <div><h2>Today’s field is unavailable</h2><p>{error}</p><button className="text-button" onClick={() => void load()}>Try again</button></div>
        </div>
      )}
      {data && !loading && (
        <div className="today-layout">
          <section className="attention-field" aria-labelledby="attention-title">
            <header className="ruled-heading">
              <div><h2 id="attention-title">Due and approaching</h2><span className="folio-label">Attention register</span></div>
              <span className="attention-total">{attention.length}</span>
            </header>
            {data.first_run ? (
              <div className="first-run">
                <MapPin aria-hidden="true" />
                <h3>Start with one known place or obligation</h3>
                <p>{data.empty_message} The fieldbook becomes useful from the first real entry; it does not fill the property with sample metrics.</p>
                <div className="first-actions">
                  <Link className="button button-primary" to="/maintenance?ledger=items"><Plus aria-hidden="true" /> Add a home item</Link>
                  <Link className="button button-quiet" to="/yard?ledger=locations">Map a yard area</Link>
                </div>
              </div>
            ) : attention.length === 0 ? (
              <div className="clear-field">
                <span><Check aria-hidden="true" /></span>
                <div><h3>No due work in the next 14 days</h3><p>The property record is current. New observations can still be logged from any domain ledger.</p></div>
              </div>
            ) : (
              <ol className="attention-list">
                {attention.slice(0, 12).map(({ kind, item }) => (
                  <li key={`${kind}-${item.id}`}>
                    <span className={`domain-pin pin-${kind.split("_")[0]}`} aria-hidden="true" />
                    <div><b>{itemTitle(item)}</b><span>{labels[kind]} · {itemMeta(item)}</span></div>
                    <Link to={`/${kind.startsWith("pool") ? "pool" : kind === "warranties" ? "maintenance" : kind}`} aria-label={`Open ${labels[kind]} ledger`}><ArrowUpRight aria-hidden="true" /></Link>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <aside className="evidence-rail" aria-label="Property evidence and quick capture">
            <section>
              <h2>Recorded evidence</h2>
              <span className="folio-label">Property index</span>
              <dl className="index-counts">
                <div><dt>Home items</dt><dd>{data.counts.home_items}</dd></div>
                <div><dt>Inventory</dt><dd>{data.counts.inventory_items}</dd></div>
                <div><dt>Garden beds</dt><dd>{data.counts.garden_beds}</dd></div>
                <div><dt>Pool reports</dt><dd>{data.counts.pool_reports}</dd></div>
                <div><dt>Recipes</dt><dd>{data.counts.recipes}</dd></div>
              </dl>
            </section>
            <section>
              <h2>Log the next action</h2>
              <span className="folio-label">Fast capture</span>
              <div className="capture-links">
                <Link to="/maintenance?ledger=tasks"><Wrench aria-hidden="true" /><span>Maintenance task<small>Due work or service note</small></span></Link>
                <Link to="/garden?ledger=tasks"><Sprout aria-hidden="true" /><span>Garden task<small>Bed, planting, or harvest</small></span></Link>
                <Link to="/pool?ledger=reports"><Plus aria-hidden="true" /><span>Pool report<small>Observation and readings</small></span></Link>
              </div>
            </section>
            {(data.context.shopping.length > 0 || data.context.recent_recipes.length > 0) && (
              <section>
                <h2>Working context</h2>
                <span className="folio-label">Kitchen and garden</span>
                <ul className="context-list">
                  {data.context.shopping.slice(0, 3).map((item) => <li key={String(item.id)}>{item.name}<small>shopping need</small></li>)}
                  {data.context.recent_recipes.slice(0, 3).map((item) => <li key={String(item.id)}>{item.name}<small>recent recipe</small></li>)}
                </ul>
              </section>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
