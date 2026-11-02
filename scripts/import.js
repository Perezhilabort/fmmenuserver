// Импорт меню из JSON-файла в базу.
//   npm run import                       (menu.json, добавляет к существующим данным)
//   npm run import -- --replace          (сначала ПОЛНОСТЬЮ очищает меню и добавки)
//   npm run import -- other.json --replace
//
// Формат: либо массив категорий, либо { "addons": [...], "categories": [...] }.
// Добавки ("addons") можно указывать на трёх уровнях: в корне, в категории (для всех её блюд)
// и в блюде. Элемент — либо полное описание {id, price, translations}, либо строка-id
// уже описанной добавки.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { pool } from '../src/db.js';
import { SUPPORTED_LANGS, DEFAULT_LANG } from '../src/languages.js';
import { ALLERGENS } from '../src/allergens.js';

const args = process.argv.slice(2);
const replace = args.includes('--replace');
const file = path.resolve(args.find((a) => !a.startsWith('--')) || 'menu.json');

// ---------- 1. Чтение файла ----------
let data;
try {
  data = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`Не удалось прочитать ${file}: ${e.message}`);
  process.exit(1);
}

// ---------- 2. Проверка ----------
const errors = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);

const categories = Array.isArray(data) ? data : data?.categories;
const rootAddons = Array.isArray(data) ? undefined : data?.addons;

function checkNames(obj, where, { description }) {
  if (!obj || typeof obj !== 'object') return err(where, 'ожидается объект с языками');
  if (!(DEFAULT_LANG in obj)) err(where, `нет обязательного языка "${DEFAULT_LANG}"`);
  for (const [lang, val] of Object.entries(obj)) {
    if (!SUPPORTED_LANGS.includes(lang)) { err(where, `неизвестный язык "${lang}"`); continue; }
    const name = description ? val?.name : val;
    if (typeof name !== 'string' || !name.trim()) err(`${where}.${lang}`, 'пустое название');
  }
}

// Каталог добавок: id -> { id, price, translations }
const catalog = new Map();
const pendingRefs = [];
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const signature = (a) =>
  JSON.stringify([a.price, Object.entries(a.translations || {}).map(([l, t]) => [l, t?.name]).sort()]);

function defineAddon(a, where) {
  if (!a || typeof a !== 'object') return err(where, 'добавка должна быть объектом или строкой-id');
  if (typeof a.id !== 'string' || !CODE_RE.test(a.id)) return err(where, `некорректный id добавки "${a.id}"`);
  const w = `${where} (${a.id})`;
  if (typeof a.price !== 'number' || !Number.isFinite(a.price) || a.price < 0) err(w, 'price должен быть числом');
  checkNames(a.translations, `${w}.translations`, { description: true });

  const prev = catalog.get(a.id);
  if (!prev) catalog.set(a.id, { id: a.id, price: a.price, translations: a.translations, sig: signature(a) });
  else if (prev.sig !== signature(a)) err(w, 'эта добавка описана по-разному в разных местах файла');
}

// Возвращает список id добавок, записывая описания в каталог
function resolveList(list, where) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) { err(where, '"addons" должен быть массивом'); return []; }
  return list
    .map((item, i) => {
      if (typeof item === 'string') {
        pendingRefs.push({ code: item, where: `${where}[${i}]` });
        return item;
      }
      defineAddon(item, `${where}[${i}]`);
      return item?.id;
    })
    .filter(Boolean);
}

const plan = []; // [{ cat, dishes: [{ dish, addonCodes }] }]

if (!Array.isArray(categories)) {
  err('menu.json', 'нужен массив категорий (или объект с полем "categories")');
} else {
  resolveList(rootAddons, 'addons');

  categories.forEach((cat, i) => {
    const c = `Категория #${i + 1}`;
    checkNames(cat.category, `${c}.category`, { description: false });
    if (!Array.isArray(cat.dishes)) { err(c, '"dishes" должен быть массивом'); return; }
    const catCodes = resolveList(cat.addons, `${c}.addons`);
    const entry = { cat, dishes: [] };

    cat.dishes.forEach((dish, j) => {
      const d = `${c}, блюдо #${j + 1}`;
      if (typeof dish.price !== 'number' || !Number.isFinite(dish.price) || dish.price < 0)
        err(d, 'price должен быть числом (без кавычек и валюты)');
      if (dish.allergens !== undefined) {
        if (!Array.isArray(dish.allergens)) err(d, 'allergens должен быть массивом');
        else for (const a of dish.allergens) if (!ALLERGENS.includes(a)) err(d, `неизвестный аллерген "${a}"`);
      }
      checkNames(dish.translations, `${d}.translations`, { description: true });
      const addonCodes = [...new Set([...catCodes, ...resolveList(dish.addons, `${d}.addons`)])];
      entry.dishes.push({ dish, addonCodes });
    });
    plan.push(entry);
  });

  for (const { code, where } of pendingRefs) {
    if (!catalog.has(code)) err(where, `неизвестная добавка "${code}": её описание нигде не найдено`);
  }
}

if (errors.length) {
  console.error(`Найдено ошибок: ${errors.length}\n`);
  errors.forEach((e) => console.error(' - ' + e));
  console.error('\nВ базу ничего не записано. Исправьте файл и запустите снова.');
  process.exit(1);
}

// ---------- 3. Запись в БД (одна транзакция) ----------
const client = await pool.connect();
try {
  await client.query('BEGIN');
  if (replace) {
    await client.query('TRUNCATE categories, addons RESTART IDENTITY CASCADE');
    console.log('Старое меню и добавки удалены');
  }

  // 3.1 каталог добавок (повторный запуск обновляет цену и названия по code)
  const addonIds = new Map();
  let n = 0;
  for (const a of catalog.values()) {
    const { rows } = await client.query(
      `INSERT INTO addons (code, price, sort_order) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET price = EXCLUDED.price, sort_order = EXCLUDED.sort_order
       RETURNING id`,
      [a.id, a.price, ++n]
    );
    addonIds.set(a.id, rows[0].id);
    for (const [lang, t] of Object.entries(a.translations)) {
      await client.query(
        `INSERT INTO addon_translations (addon_id, lang, name) VALUES ($1, $2, $3)
         ON CONFLICT (addon_id, lang) DO UPDATE SET name = EXCLUDED.name`,
        [rows[0].id, lang, t.name.trim()]
      );
    }
  }

  // 3.2 категории, блюда, связи блюдо-добавка
  let dishCount = 0;
  let linkCount = 0;
  for (const [i, { cat, dishes }] of plan.entries()) {
    const { rows } = await client.query('INSERT INTO categories (sort_order) VALUES ($1) RETURNING id', [i + 1]);
    const categoryId = rows[0].id;
    for (const [lang, name] of Object.entries(cat.category)) {
      await client.query(
        'INSERT INTO category_translations (category_id, lang, name) VALUES ($1, $2, $3)',
        [categoryId, lang, name.trim()]
      );
    }

    for (const [j, { dish, addonCodes }] of dishes.entries()) {
      const res = await client.query(
        `INSERT INTO dishes (category_id, price, image_url, allergens, sort_order)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [categoryId, dish.price, dish.image_url || null, dish.allergens || [], j + 1]
      );
      const dishId = res.rows[0].id;
      for (const [lang, t] of Object.entries(dish.translations)) {
        await client.query(
          'INSERT INTO dish_translations (dish_id, lang, name, description) VALUES ($1, $2, $3, $4)',
          [dishId, lang, t.name.trim(), t.description?.trim() || null]
        );
      }
      for (const [k, code] of addonCodes.entries()) {
        await client.query(
          'INSERT INTO dish_addons (dish_id, addon_id, sort_order) VALUES ($1, $2, $3)',
          [dishId, addonIds.get(code), k + 1]
        );
        linkCount++;
      }
      dishCount++;
    }
  }

  await client.query('COMMIT');
  console.log(`Готово: категорий ${plan.length}, блюд ${dishCount}, добавок ${catalog.size} (связей с блюдами: ${linkCount})`);
} catch (e) {
  await client.query('ROLLBACK');
  console.error('Ошибка импорта, изменения отменены:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
