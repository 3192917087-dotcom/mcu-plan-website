# MCU Studio V2 workspace override

This page overrides the generated editorial palette while keeping its Swiss grid, restrained motion, strong hierarchy, and content-first layout.

## Direction

- Product type: focused engineering writing workspace, not a marketing page.
- Mood: bright, calm, trustworthy, efficient.
- Keep one primary task per screen and reveal advanced fields only when requested.
- Do not repeat progress, project name, or instructions in multiple cards.

## Color tokens

| Role | Value |
|---|---|
| Background | `#F6F8F7` |
| Surface | `#FFFFFF` |
| Surface subtle | `#EEF5F2` |
| Text | `#17211E` |
| Muted text | `#52615C` |
| Border | `#DCE5E1` |
| Primary | `#087A68` |
| Primary hover | `#066354` |
| Accent | `#BD5313` |
| Accent hover | `#9F3F08` |
| Success | `#19704C` |
| Warning | `#A85B08` |
| Danger | `#B42318` |

All primary and accent buttons use white text. Color is never the only state indicator.

## Typography

- Use a local system sans-serif stack to avoid external font latency.
- Headings: `Inter, "Microsoft YaHei", "PingFang SC", sans-serif`.
- Body: `Inter, "Microsoft YaHei", "PingFang SC", sans-serif`.
- Body size: 16px; helper text: minimum 13px.
- Long explanatory copy is limited to 70 Chinese characters per line and hidden behind expandable help where possible.

## Layout

- Desktop: 248px project/navigation rail + fluid workspace; maximum content width 1280px.
- Tablet: compact top navigation; two-column forms collapse to one column.
- Mobile: single column, bottom-safe action area, no horizontal scrolling.
- Use 8px spacing rhythm and 12px corner radius.
- Cards use borders and minimal shadows; do not make every section a floating card.

## Generation experience

- One progress surface only.
- Show current stage, completed chapters, elapsed time, and the next operation.
- Save after every completed chapter.
- `Download current draft` stays available after the first chapter, even when generation is running, paused, failed, or quality checks have warnings.
- Pause and resume happen between durable checkpoints.

## Avoid

- Large welcome banners, repeated helper paragraphs, decorative gradients, dark themes, oversized icons, emoji icons, or modal-only progress.
- A fake project switcher backed by a single project record.
- Blocking download on quality status.
