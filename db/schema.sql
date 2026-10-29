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
  sort_order   INT NOT NULL DEFAULT 0
  allergens TEXT[] NOT NULL DEFAULT '{}',
);

CREATE TABLE IF NOT EXISTS dish_translations (
  dish_id     INT NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  lang        VARCHAR(5) NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  PRIMARY KEY (dish_id, lang)
);

CREATE INDEX IF NOT EXISTS idx_dishes_category ON dishes(category_id);
