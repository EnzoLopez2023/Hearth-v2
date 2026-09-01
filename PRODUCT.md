# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Hearth-v2 serves members of one household who steward a property over time. They need to understand what requires attention, where it belongs, what evidence exists, and what action was taken. This audience and its operating situation are derived from the authoritative build brief.

## Product Purpose

Hearth-v2 is the dependable system of record for household and property work: dashboard attention, home maintenance, home inventory, yard maintenance, garden, pool maintenance, and recipes. Success means a household member can find, create, update, and reconcile owned records without relying on the legacy Hearth monolith or any extracted product.

## Positioning

The product organizes a home as a mapped system of places, objects, obligations, and evidence. It joins operational records to household ownership and durable identifiers rather than presenting a generic smart-home dashboard or a launcher for neighboring apps.

## Operating Context

Members use the product on desktop and mobile while planning work, inspecting property areas, recording costs and evidence, checking inventory, tending garden and pool tasks, and managing recipes and shopping context. Printed HEARTH QR identifiers may already be attached to physical objects and must remain resolvable.

## Capabilities and Constraints

- Owned capabilities are Dashboard, Home Maintenance, Home Inventory, Yard Maintenance, Garden, Pool Maintenance, and Recipe Manager.
- ShapePilot, Lantern, Marquee, Prism, and Watchtower are separate products and must not be reimplemented, embedded, proxied, or presented as portal destinations.
- Data is household-scoped in an isolated migration-managed SQLite database using synchronous `better-sqlite3`, DELETE journal mode, and foreign keys.
- Production uses app-local authorization at an Entra/OIDC-ready boundary and fails closed when authentication is unconfigured. Explicit development identity is non-production only.
- Optional AI, weather/geocoding, and blob providers are typed boundaries and are not startup requirements.
- Legacy import is a later, explicit operator action from a read-only source. It must be deterministic, restart-safe, reconciled, and conflict-refusing.
- Live Hearth data, production personal data, Azure resources, DNS, and iOS applications are outside this build.

## Brand Commitments

The product name is Hearth-v2. Its binding visual direction is the legacy Hearth “the home you keep” interface at commit `f0b05fc1dbf53e8aa26c215d8e858894a2793871`: warm editorial typography, page-specific household photography and palettes, floating translucent navigation, rounded journal surfaces, and compact pill controls. Hearth-v2 preserves that visual identity without restoring legacy-only products or changing v2 ownership boundaries.

## Evidence on Hand

The legacy Hearth repository at commit `f0b05fc1dbf53e8aa26c215d8e858894a2793871` is the visual source of truth and evidence for household behavior, labels, and data semantics. No production data, personal data, customer proof, benchmarks, or deployment evidence is available and none may be fabricated.

## Product Principles

1. Put today’s property work before navigation or decoration.
2. Keep every user-owned record inside an explicit household authorization boundary.
3. Preserve physical-world identifiers and evidence for the lifetime of the record.
4. Make optional providers honest and replaceable, never hidden startup dependencies.
5. Treat legacy import and future cutover as controlled, reversible operator work.

## Accessibility & Inclusion

The web application must support keyboard operation, visible focus, accessible labels and dialogs, reduced motion, strong contrast, and responsive desktop/mobile use. Status and domain meaning cannot rely on color alone.
