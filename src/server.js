const path = require('path');
const express = require('express');
const api = require('./routes');

const app = express();
app.use(express.json());
app.use((req, _res, next) => { if (req.path.startsWith('/api')) console.log(new Date().toISOString(), req.method, req.path); next(); });
app.use('/api', api);
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use((err, _req, res, _next) => { console.error(err); res.status(err.status || 500).json({ error: err.message || 'Server error' }); });

const PORT = require('./config').PORT;
app.listen(PORT, () => console.log(`Vaccine inventory prototype running at http://localhost:${PORT}`));
