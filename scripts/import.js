// Импорт меню из JSON-файла в базу.
// Запуск:  npm run import                       (файл menu.json, добавляет к существующим данным)
//          npm run import -- --replace          (сначала ПОЛНОСТЬЮ очищает меню)
//          npm run import -- other.json --replace
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { pool } from '../src/db.js';
import { SUPPORTED_LANGS, DEFAULT_LANG } from '../src/languages.js';
import { ALLERGENS } from './allergens.js';

const args = process.argv.slice(2);
const replace = args.includes('--replace');
const file = path.resolve(args.find((a) => !a.startsWith('--')) || 'menu.JSON');

// ---------- 1. Чтение файла ----------
let data;
try {
  data = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (err) {
  console.error(`Не удалось прочитать ${file}: ${err.message}`);
  process.exit(1);
}

// ---------- 2. Проверка ----------
const errors = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);

function checkNames(obj, where, { description }) {
  if (!obj || typeof obj !== 'object') return err(where, 'ожидается объект с языками');
  if (!(DEFAULT_LANG in obj)) err(where, `нет обязательного языка "${DEFAULT_LANG}"`);
  for (const [lang, val] of Object.entries(obj)) {
    if (!SUPPORTED_LANGS.includes(lang)) { err(where, `неизвестный язык "${lang}"`); continue; }
    const name = description ? val?.name : val;
    if (typeof name !== 'string' || !name.trim()) err(`${where}.${lang}`, 'пустое название');
  }
}

if (!Array.isArray(data)) {
  err('menu.json', 'верхний уровень должен быть массивом категорий');
} else {
  data.forEach((cat, i) => {
    const c = `Категория #${i + 1}`;
    checkNames(cat.category, `${c}.category`, { description: false });
    if (!Array.isArray(cat.dishes)) return err(c, '"dishes" должен быть массивом');
    cat.dishes.forEach((dish, j) => {
      const d = `${c}, блюдо #${j + 1}`;
      if (typeof dish.price !== 'number' || !Number.isFinite(dish.price) || dish.price < 0)
        err(d, 'price должен быть числом (без кавычек и валюты)');
      if (dish.allergens !== undefined) {
        if (!Array.isArray(dish.allergens)) err(d, 'allergens должен быть массивом');
        else for (const a of dish.allergens)
          if (!ALLERGENS.includes(a)) err(d, `неизвестный аллерген "${a}"`);
      }
      checkNames(dish.translations, `${d}.translations`, { description: true });
    });
  });
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
    await client.query('TRUNCATE categories RESTART IDENTITY CASCADE');
    console.log('Старое меню удалено');
  }

  let dishCount = 0;
  for (const [i, cat] of data.entries()) {
    const { rows } = await client.query(
      'INSERT INTO categories (sort_order) VALUES ($1) RETURNING id', [i + 1]
    );
    const categoryId = rows[0].id;

    for (const [lang, name] of Object.entries(cat.category)) {
      await client.query(
        'INSERT INTO category_translations (category_id, lang, name) VALUES ($1, $2, $3)',
        [categoryId, lang, name.trim()]
      );
    }

    for (const [j, dish] of cat.dishes.entries()) {
      const res = await client.query(
        `INSERT INTO dishes (category_id, price, image_url, allergens, sort_order)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [categoryId, dish.price, dish.image_url || null, dish.allergens || [], j + 1]
      );
      for (const [lang, t] of Object.entries(dish.translations)) {
        await client.query(
          `INSERT INTO dish_translations (dish_id, lang, name, description)
           VALUES ($1, $2, $3, $4)`,
          [res.rows[0].id, lang, t.name.trim(), t.description?.trim() || null]
        );
      }
      dishCount++;
    }
  }

  await client.query('COMMIT');
  console.log(`Готово: категорий ${data.length}, блюд ${dishCount}`);
} catch (e) {
  await client.query('ROLLBACK');
  console.error('Ошибка импорта, изменения отменены:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
