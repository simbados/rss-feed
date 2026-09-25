-- Image URL of an article (from media:thumbnail, an image enclosure or the first <img>).
-- Served through the /img/<id> proxy, never linked directly.
ALTER TABLE articles ADD COLUMN image_url TEXT NOT NULL DEFAULT '';
