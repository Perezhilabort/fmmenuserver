import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import menuRouter from './routes/menu.js';
import adminRouter from './routes/admin.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api', menuRouter);
app.use('/api/admin', adminRouter);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  // 23503 = нарушение внешнего ключа (например, несуществующая category_id)
  if (err.code === '23503') return res.status(400).json({ error: 'Related record does not exist' });
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`Menu API: http://localhost:${port}`));
