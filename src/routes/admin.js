import { Router } from 'express';
import { pool } from '../db.js';
import { SUPPORTED_LANGS, DEFAULT_LANG } from '../languages.js';
import { ALLERGENS } from '../allergens.js';
import { login, requireAdmin } from '../auth.js';

const router = Router();

// Вход открыт всем, всё остальное — только с токеном
router.post('/login', login);
router.use(requireAdmin);

// --- Хелперы ---
function validateTranslations(translations) {
  if (!translations || typeof translations !== 'object') return 'translations is required';
  const langs = Object.keys(translations);
  if (!langs.includes(DEFAULT_LANG)) return `translation for "${DEFAULT_LANG}" is required`;
  for (const lang of langs) {
    if (!SUPPORTED_LANGS.includes(lang)) return `unsupported language: ${lang}`;
    if (!translations[lang]?.name?.trim()) return `name is required for "${lang}"`;
  }
  return null;
}

function validateAllergens(allergens) {
  if (allergens === undefined) return null;
  if (!Array.isArray(allergens) || !allergens.every((a) => ALLERGENS.includes(a))) return 'unknown allergen';
  return null;
}

function parseId(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid id' });
    return null;
  }
  return id;
}

async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Переводы считаются полным списком: языки, которых нет в запросе, удаляются.
async function saveCategoryTranslations(client, id, translations) {
  for (const [lang, t] of Object.entries(translations)) {
    await client.query(
      `INSERT INTO category_translations (category_id, lang, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (category_id, lang) DO UPDATE SET name = EXCLUDED.name`,
      [id, lang, t.name.trim()]
    );
  }
  await client.query(
    'DELETE FROM category_translations WHERE category_id = $1 AND lang <> ALL($2::text[])',
    [id, Object.keys(translations)]
  );
}

async function saveDishTranslations(client, id, translations) {
  for (const [lang, t] of Object.entries(translations)) {
    await client.query(
      `INSERT INTO dish_translations (dish_id, lang, name, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (dish_id, lang) DO UPDATE
       SET name = EXCLUDED.name, description = EXCLUDED.description`,
      [id, lang, t.name.trim(), t.description?.trim() || null]
    );
  }
  await client.query(
    'DELETE FROM dish_translations WHERE dish_id = $1 AND lang <> ALL($2::text[])',
    [id, Object.keys(translations)]
  );
}

// --- Полное меню со всеми переводами (для админки) ---
router.get('/menu', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.id, c.sort_order,
        COALESCE((SELECT json_object_agg(lang, json_build_object('name', name))
           FROM category_translations WHERE category_id = c.id), '{}') AS translations,
        COALESCE((
          SELECT json_agg(json_build_object(
            'id', d.id, 'price', d.price::float8, 'image_url', d.image_url,
            'is_available', d.is_available, 'sort_order', d.sort_order,
            'allergens', d.allergens,
            'translations', COALESCE((
              SELECT json_object_agg(lang, json_build_object('name', name, 'description', description))
              FROM dish_translations WHERE dish_id = d.id), '{}')
          ) ORDER BY d.sort_order, d.id)
          FROM dishes d WHERE d.category_id = c.id
        ), '[]') AS dishes
      FROM categories c ORDER BY c.sort_order, c.id
    `);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// --- Категории ---
router.post('/categories', async (req, res, next) => {
  try {
    const { sort_order = 0, translations } = req.body;
    const error = validateTranslations(translations);
    if (error) return res.status(400).json({ error });

    const id = await withTx(async (client) => {
      const { rows } = await client.query(
        'INSERT INTO categories (sort_order) VALUES ($1) RETURNING id', [sort_order]
      );
      await saveCategoryTranslations(client, rows[0].id, translations);
      return rows[0].id;
    });
    res.status(201).json({ id });
  } catch (err) {
    next(err);
  }
});

router.put('/categories/:id', async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    const { sort_order, translations } = req.body;
    if (translations) {
      const error = validateTranslations(translations);
      if (error) return res.status(400).json({ error });
    }
    const found = await withTx(async (client) => {
      const { rowCount } = await client.query(
        'UPDATE categories SET sort_order = COALESCE($2, sort_order) WHERE id = $1', [id, sort_order]
      );
      if (rowCount && translations) await saveCategoryTranslations(client, id, translations);
      return rowCount;
    });
    if (!found) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Вместе с категорией удаляются все её блюда (ON DELETE CASCADE)
router.delete('/categories/:id', async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    const { rowCount } = await pool.query('DELETE FROM categories WHERE id = $1', [id]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// --- Блюда ---
router.post('/dishes', async (req, res, next) => {
  try {
    const { category_id, price, image_url, sort_order = 0, is_available = true, allergens = [], translations } = req.body;
    if (!Number.isFinite(Number(price)) || Number(price) < 0) return res.status(400).json({ error: 'invalid price' });
    const allergenError = validateAllergens(allergens);
    if (allergenError) return res.status(400).json({ error: allergenError });
    const error = validateTranslations(translations);
    if (error) return res.status(400).json({ error });

    const id = await withTx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO dishes (category_id, price, image_url, sort_order, is_available, allergens)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [category_id, price, image_url || null, sort_order, is_available, allergens]
      );
      await saveDishTranslations(client, rows[0].id, translations);
      return rows[0].id;
    });
    res.status(201).json({ id });
  } catch (err) {
    next(err);
  }
});

router.put('/dishes/:id', async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    const { category_id, price, image_url, sort_order, is_available, allergens, translations } = req.body;
    if (price !== undefined && (!Number.isFinite(Number(price)) || Number(price) < 0)) {
      return res.status(400).json({ error: 'invalid price' });
    }
    const allergenError = validateAllergens(allergens);
    if (allergenError) return res.status(400).json({ error: allergenError });
    if (translations) {
      const error = validateTranslations(translations);
      if (error) return res.status(400).json({ error });
    }
    const found = await withTx(async (client) => {
      // image_url: не передан — не меняем, пустая строка — очищаем
      const { rowCount } = await client.query(
        `UPDATE dishes SET
           category_id  = COALESCE($2, category_id),
           price        = COALESCE($3, price),
           image_url    = CASE WHEN $4::text IS NULL THEN image_url
                               WHEN $4::text = '' THEN NULL
                               ELSE $4::text END,
           sort_order   = COALESCE($5, sort_order),
           is_available = COALESCE($6, is_available),
           allergens    = COALESCE($7, allergens)
         WHERE id = $1`,
        [id, category_id, price, image_url, sort_order, is_available, allergens]
      );
      if (rowCount && translations) await saveDishTranslations(client, id, translations);
      return rowCount;
    });
    if (!found) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Быстро скрыть/показать блюдо («стоп-лист»)
router.patch('/dishes/:id/availability', async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    const { is_available } = req.body;
    if (typeof is_available !== 'boolean') return res.status(400).json({ error: 'is_available must be boolean' });
    const { rowCount } = await pool.query('UPDATE dishes SET is_available = $2 WHERE id = $1', [id, is_available]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/dishes/:id', async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    const { rowCount } = await pool.query('DELETE FROM dishes WHERE id = $1', [id]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
