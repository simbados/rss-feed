-- Pause a topic in the "All" timeline on chosen weekdays (e.g. no security news on Fri–Sun).
-- Bit 0 = Monday … bit 6 = Sunday (Europe/Berlin); 0 = never paused. The topic's own view, its sidebar
-- count and the daily summary are unaffected. Additive only: old code ignores the column.
ALTER TABLE topics ADD COLUMN pause_days INTEGER NOT NULL DEFAULT 0;
