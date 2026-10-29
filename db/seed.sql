INSERT INTO categories (id, sort_order) VALUES (1, 1), (2, 2) ON CONFLICT DO NOTHING;

INSERT INTO category_translations (category_id, lang, name) VALUES
 (1,'ru','Кофе'),(1,'en','Coffee'),(1,'kk','Кофе'),(1,'tr','Kahveler'),(1,'zh','咖啡'),(1,'de','Kaffee'),
 (2,'ru','Десерты'),(2,'en','Desserts'),(2,'kk','Десерттер'),(2,'tr','Tatlılar'),(2,'zh','甜点'),(2,'de','Desserts')
ON CONFLICT DO NOTHING;

INSERT INTO dishes (id, category_id, price, sort_order) VALUES
 (1, 1, 1500, 1), (2, 1, 1700, 2), (3, 2, 2200, 1)
ON CONFLICT DO NOTHING;

INSERT INTO dish_translations (dish_id, lang, name, description) VALUES
 (1,'ru','Капучино','Эспрессо и воздушная молочная пена'),
 (1,'en','Cappuccino','Espresso with airy steamed milk foam'),
 (1,'kk','Капучино','Эспрессо мен көпіршіген сүт'),
 (1,'tr','Kapuçino','Espresso ve süt köpüğü'),
 (1,'zh','卡布奇诺','浓缩咖啡配绵密奶泡'),
 (1,'de','Cappuccino','Espresso mit Milchschaum'),

 (2,'ru','Латте','Эспрессо с большим количеством молока'),
 (2,'en','Latte','Espresso with plenty of steamed milk'),
 (2,'kk','Латте','Эспрессо мен көп сүт'),
 (2,'tr','Latte','Espresso ve bol süt'),
 (2,'zh','拿铁','浓缩咖啡配大量牛奶'),
 (2,'de','Latte','Espresso mit viel Milch'),

 (3,'ru','Чизкейк','Нежный сливочный сыр на песочной основе'),
 (3,'en','Cheesecake','Creamy cheesecake on a biscuit base'),
 (3,'kk','Чизкейк','Нәзік сүзбе кремі мен құмдауық негізі'),
 (3,'tr','Cheesecake','Kremsi peynirli kek, gevrek taban'),
 (3,'zh','芝士蛋糕','奶香浓郁，饼干底'),
 (3,'de','Käsekuchen','Cremiger Käsekuchen mit Keksboden')
ON CONFLICT DO NOTHING;

SELECT setval('categories_id_seq', (SELECT MAX(id) FROM categories));
SELECT setval('dishes_id_seq', (SELECT MAX(id) FROM dishes));
