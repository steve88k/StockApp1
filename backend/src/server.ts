import cors from 'cors';
import express from 'express';
import predictRoutes from './routes/predictRoutes';

const app = express();
const PORT = 8787;

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ok: true, service: 'stock-ui-starter-backend'});
});

app.use('/api', predictRoutes);

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
