# System Director 2.2.0 — UI Blueprint 4

## Components & Data Binding

- Added linked reusable **Component** instances backed by saved Blueprint templates.
- Added **Repeater** for rendering a component once per array entry, with row/index/count context, filtering, sorting, limits, and row/column/grid layouts.
- Added typed property bindings: Blueprint Variable, Widget Property, Formula, UI Context, and Repeater Row.
- Added binding transforms for text, number, boolean, round, and percent values.
- Added `Hidden` versus `Collapsed` visibility behavior.
- UI event payloads now expose element ID, row, index, count, label, and structured payload data.
- Added schema v3 → v4 migration and validation for component/template and binding references.
- Preserved v3 layouts, variables, events, saved templates, and legacy binding values.

## Set Value target safety

- Preserved and expanded the target-aware Set Value workflow: Actor, Item, owned Item, target token, token ID, UUID, and connected references.
- Variable choices follow the effective Actor/Item scope and runtime rejects incompatible writes.
