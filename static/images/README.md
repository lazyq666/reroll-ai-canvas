# Static image assets

Keep assets grouped by product purpose rather than file format:

- `brand/`: Reroll identity assets, favicon, wordmarks, and brand motion.
- `providers/`: external Provider and Model brand marks, plus their license notices.
- `ui/`: visual assets owned by reusable interface components.
- `test/`: deterministic fixtures used only by prototypes and automated tests.

Do not add new files directly to this directory. Put them in the narrowest existing
category, and add a new category only when several assets share a durable purpose.
