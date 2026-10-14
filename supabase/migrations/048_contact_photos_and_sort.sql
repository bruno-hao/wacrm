-- ============================================================
-- 048: contact photos (WAHA) + alphabetical contact ordering
--
-- avatar_synced_at — when we last tried to fetch the contact's WhatsApp
--   profile photo (success or "no photo"), so the sync runs once per
--   contact and then only on a slow refresh instead of on every message.
--
-- sort_name — a generated, immutable sort key so the list can be ordered
--   A→Z in SQL (and paged) regardless of accents, case, or leading
--   emoji/punctuation. Contacts that have no letters in their name
--   (unnamed ones, stored as their phone number) sort AFTER every named
--   contact.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS avatar_synced_at TIMESTAMPTZ;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS sort_name TEXT GENERATED ALWAYS AS (
    CASE
      WHEN coalesce(name, '') ~ '[[:alpha:]]' THEN 'a'
      ELSE 'z'
    END
    || translate(
         lower(regexp_replace(coalesce(name, ''), '^[^[:alpha:]]+', '')),
         'áàâãäåéèêëíìîïóòôõöúùûüçñ',
         'aaaaaaeeeeiiiiooooouuuucn'
       )
  ) STORED;

CREATE INDEX IF NOT EXISTS contacts_account_sort_name_idx
  ON contacts (account_id, sort_name, id);

-- Tag-filtered list: same A→Z order as the plain list.
CREATE OR REPLACE FUNCTION public.filter_contacts_by_tags(
  p_tag_ids UUID[],
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (contact contacts, total_count BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH matched AS (
    SELECT DISTINCT c.id, c.sort_name
    FROM contacts c
    JOIN contact_tags ct ON ct.contact_id = c.id
    WHERE ct.tag_id = ANY(p_tag_ids)
      AND (
        p_search IS NULL
        OR c.name ILIKE '%' || p_search || '%'
        OR c.phone ILIKE '%' || p_search || '%'
        OR c.email ILIKE '%' || p_search || '%'
      )
  ),
  page AS (
    SELECT id, count(*) OVER() AS total_count
    FROM matched
    ORDER BY sort_name, id
    LIMIT p_limit OFFSET p_offset
  )
  SELECT c AS contact, page.total_count
  FROM page
  JOIN contacts c ON c.id = page.id
  ORDER BY c.sort_name, c.id;
$$;

ALTER FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT) TO authenticated;
