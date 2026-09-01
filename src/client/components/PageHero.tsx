import type { ReactNode } from "react";

export interface HeroStat {
  label: string;
  value: ReactNode;
}

interface PageHeroProps {
  eyebrow?: string;
  title: string;
  accentPhrase?: string | undefined;
  subtitle: ReactNode;
  actions?: ReactNode | undefined;
  variant?: "default" | "pool";
  stats?: HeroStat[] | undefined;
}

function titleSegments(title: string, accentPhrase?: string) {
  if (!accentPhrase || !title.includes(accentPhrase)) {
    return [{ text: title, accent: false }];
  }

  const index = title.indexOf(accentPhrase);
  return [
    ...(index > 0 ? [{ text: title.slice(0, index), accent: false }] : []),
    { text: accentPhrase, accent: true },
    ...(index + accentPhrase.length < title.length
      ? [{ text: title.slice(index + accentPhrase.length), accent: false }]
      : [])
  ];
}

function Embers() {
  return (
    <span className="hero-embers" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export function PageHero({
  eyebrow,
  title,
  accentPhrase,
  subtitle,
  actions,
  variant = "default",
  stats = []
}: PageHeroProps) {
  if (variant === "pool") {
    return (
      <section className="page-hero pool-hero">
        <span className="pool-caustics" aria-hidden="true" />
        <div className="pool-hero-copy">
          {eyebrow && <span className="pool-eyebrow">{eyebrow}</span>}
          <h1>{title}</h1>
          <p>{subtitle}</p>
          {actions && <div className="pool-hero-actions">{actions}</div>}
        </div>
        {stats.length > 0 && (
          <dl className="hero-stats">
            {stats.map((stat) => (
              <div key={stat.label}>
                <dt>{stat.label}</dt>
                <dd>{stat.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    );
  }

  return (
    <section className="page-hero">
      <Embers />
      <div className="page-hero-row">
        <div className="page-hero-copy">
          {eyebrow && <span className="hero-eyebrow"><i aria-hidden="true" />{eyebrow}</span>}
          <h1>
            {titleSegments(title, accentPhrase).map((segment, index) => (
              segment.accent
                ? <em key={`${segment.text}-${index}`}>{segment.text}</em>
                : <span key={`${segment.text}-${index}`}>{segment.text}</span>
            ))}
          </h1>
          <span className="hero-rule" aria-hidden="true" />
          <p>{subtitle}</p>
        </div>
        {actions && <div className="page-hero-actions">{actions}</div>}
      </div>
    </section>
  );
}
