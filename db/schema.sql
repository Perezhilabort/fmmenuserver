CREATE TABLE IF NOT EXISTS categories (
  id         SERIAL PRIMARY KEY,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS category_translations (
  category_id INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  lang        VARCHAR(5) NOT NULL,
  name        TEXT NOT NULL,
  PRIMARY KEY (category_id, lang)
);

CREATE TABLE IF NOT EXISTS dishes (
  id           SERIAL PRIMARY KEY,
  category_id  INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  price        NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  image_url    TEXT,
  is_available BOOLEAN NOT NULL DEFAULT true,
  allergens    TEXT[] NOT NULL DEFAULT '{}',
  sort_order   INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dish_translations (
  dish_id     INT NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  lang        VARCHAR(5) NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  PRIMARY KEY (dish_id, lang)
);

CREATE INDEX IF NOT EXISTS idx_dishes_category ON dishes(category_id);

-- Добавки (сиропы, альтернативное молоко и т.п.)
CREATE TABLE IF NOT EXISTS addons (
  id           SERIAL PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,            -- id из menu.json, например 'syrup-caramel'
  price        NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  is_available BOOLEAN NOT NULL DEFAULT true,
  sort_order   INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS addon_translations (
  addon_id INT NOT NULL REFERENCES addons(id) ON DELETE CASCADE,
  lang     VARCHAR(5) NOT NULL,
  name     TEXT NOT NULL,
  PRIMARY KEY (addon_id, lang)
);

-- Какие добавки доступны к какому блюду
CREATE TABLE IF NOT EXISTS dish_addons (
  dish_id    INT NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  addon_id   INT NOT NULL REFERENCES addons(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (dish_id, addon_id)
);
CREATE INDEX IF NOT EXISTS idx_dish_addons_addon ON dish_addons(addon_id);
