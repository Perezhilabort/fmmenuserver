import { Router } from 'express';
import { pool } from '../db.js';
import { pickLang, DEFAULT_LANG, SUPPORTED_LANGS } from '../languages.js';

const router = Router();

// $1 = запрошенный язык, $2 = язык по умолчанию (fallback)
const MENU_QUERY = `
  SELECT
    c.id,
    COALESCE(ct.name, ctd.name) AS name,
    COALESCE(
      json_agg(
        json_build_object(
          'id', d.id,
          'name', COALESCE(dt.name, dtd.name),
          'description', COALESCE(dt.description, dtd.description),
          'price', d.price::float8,
          'allergens', d.allergens,
          'image_url', d.image_url
        ) ORDER BY d.sort_order, d.id
      ) FILTER (WHERE d.id IS NOT NULL),
      '[]'
    ) AS dishes
  FROM categories c
  LEFT JOIN category_translations ct  ON ct.category_id  = c.id AND ct.lang  = $1
  LEFT JOIN category_translations ctd ON ctd.category_id = c.id AND ctd.lang = $2
  LEFT JOIN dishes d ON d.category_id = c.id AND d.is_available = true
  LEFT JOIN dish_translations dt  ON dt.dish_id  = d.id AND dt.lang  = $1
  LEFT JOIN dish_translations dtd ON dtd.dish_id = d.id AND dtd.lang = $2
  GROUP BY c.id, c.sort_order, ct.name, ctd.name
  ORDER BY c.sort_order, c.id
`;

router.get('/languages', (_req, res) => {
  res.json({ languages: SUPPORTED_LANGS, default: DEFAULT_LANG });
});

router.get('/menu', async (req, res, next) => {
  try {
    const lang = pickLang(req.query.lang);
    const { rows } = await pool.query(MENU_QUERY, [lang, DEFAULT_LANG]);
    res.json({ lang, categories: rows });
  } catch (err) {
    next(err);
  }
});

export default router;
