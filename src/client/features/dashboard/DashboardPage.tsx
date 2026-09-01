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
  const recordCount = data ? Object.values(data.counts).reduce((total, count) => total + count, 0) : 0;
  const hour = new Date().getHours();
  const greeting = hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : hour < 21 ? "Good evening" : "Good night";
  const today = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date());

  return (
    <main className="work-field dashboard-page">
      <section className="hearth-hero">
        <span className="hero-embers" aria-hidden="true"><i /><i /><i /></span>
        <div className="hearth-hero-copy">
          <span>{today}</span>
          <h1>{greeting}, <em>friend</em></h1>
          <p>Welcome back to the home you keep — every record that keeps it running, warm by the fire.</p>
        </div>
        {data && (
          <dl className="hearth-glance">
            <div><dt>Home upkeep</dt><dd>{attention.length ? `${attention.length} due soon` : "All caught up"}</dd></div>
            <div><dt>Property record</dt><dd>{recordCount} entries</dd></div>
          </dl>
        )}
      </section>

      {loading && <div className="dashboard-loading"><div className="skeleton-card" /><div className="skeleton-card" /><div className="skeleton-card" /></div>}
      {error && (
        <div className="state-panel state-error dashboard-state" role="alert">
          <AlertTriangle aria-hidden="true" />
          <div><h2>Home overview unavailable</h2><p>{error}</p><button className="text-button" onClick={() => void load()}>Try again</button></div>
        </div>
      )}
      {data && !loading && (
        <>
          <section className="dashboard-section" aria-labelledby="attention-title">
            <h2 className="section-label" id="attention-title">Needs attention</h2>
            <div className="dashboard-panel attention-panel">
              <header>
                <div><h3>Due and approaching</h3><p>Work and evidence coming up across the home.</p></div>
                <span className="attention-total">{attention.length}</span>
              </header>
            {data.first_run ? (
              <div className="first-run">
                <MapPin aria-hidden="true" />
                <h3>Start with one known place or obligation</h3>
                <p>{data.empty_message} Hearth becomes useful from the first real entry; it does not fill your home with sample records.</p>
                <div className="first-actions">
                  <Link className="button button-primary" to="/maintenance?ledger=items"><Plus aria-hidden="true" /> Add a home item</Link>
                  <Link className="button button-quiet" to="/yard?ledger=locations">Map a yard area</Link>
                </div>
              </div>
            ) : attention.length === 0 ? (
              <div className="clear-field">
                <span><Check aria-hidden="true" /></span>
                <div><h3>No due work in the next 14 days</h3><p>Your home record is current. New observations can still be logged from any section.</p></div>
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
            </div>
          </section>

          <section className="dashboard-section" aria-labelledby="glance-title">
            <h2 className="section-label" id="glance-title">At a glance</h2>
            <div className="summary-grid">
              <Link className="summary-card" to="/maintenance?ledger=items"><span>Home items</span><strong>{data.counts.home_items}</strong><small>Maintenance record</small></Link>
              <Link className="summary-card" to="/inventory"><span>Inventory</span><strong>{data.counts.inventory_items}</strong><small>Items on hand</small></Link>
              <Link className="summary-card" to="/garden?ledger=beds"><span>Garden beds</span><strong>{data.counts.garden_beds}</strong><small>Growing spaces</small></Link>
              <Link className="summary-card" to="/pool?ledger=reports"><span>Pool reports</span><strong>{data.counts.pool_reports}</strong><small>Water history</small></Link>
              <Link className="summary-card" to="/recipes"><span>Recipes</span><strong>{data.counts.recipes}</strong><small>Kitchen collection</small></Link>
            </div>
          </section>

          <section className="dashboard-section" aria-labelledby="capture-title">
            <h2 className="section-label" id="capture-title">Quick access</h2>
            <div className="capture-grid">
              <Link to="/maintenance?ledger=tasks"><Wrench aria-hidden="true" /><span>Maintenance task<small>Due work or service note</small></span><ArrowUpRight aria-hidden="true" /></Link>
              <Link to="/garden?ledger=tasks"><Sprout aria-hidden="true" /><span>Garden task<small>Bed, planting, or harvest</small></span><ArrowUpRight aria-hidden="true" /></Link>
              <Link to="/pool?ledger=reports"><Plus aria-hidden="true" /><span>Pool report<small>Observation and readings</small></span><ArrowUpRight aria-hidden="true" /></Link>
              <Link to="/maintenance?ledger=tasks"><ClipboardPlus aria-hidden="true" /><span>Log property work<small>Record the next useful action</small></span><ArrowUpRight aria-hidden="true" /></Link>
            </div>
          </section>

          {(data.context.shopping.length > 0 || data.context.recent_recipes.length > 0) && (
            <section className="dashboard-section" aria-labelledby="context-title">
              <h2 className="section-label" id="context-title">Kitchen &amp; garden</h2>
              <ul className="context-list dashboard-panel">
                {data.context.shopping.slice(0, 3).map((item) => <li key={String(item.id)}>{item.name}<small>shopping need</small></li>)}
                {data.context.recent_recipes.slice(0, 3).map((item) => <li key={String(item.id)}>{item.name}<small>recent recipe</small></li>)}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
