import express from 'express';
import sqlite3 from 'sqlite3';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';

const app = express();
const PORT = process.env.PORT || 3001;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Inicializar base de datos SQLite
const db = new sqlite3.Database('./gmao.db', (err) => {
  if (err) console.error('Error al abrir BD:', err);
  else console.log('Base de datos SQLite conectada');
});

// Crear tablas si no existen
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    rol TEXT NOT NULL,
    activo INTEGER DEFAULT 1
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    contacto TEXT,
    telefono TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS inventario (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contrato TEXT NOT NULL,
    zona TEXT NOT NULL,
    equipo TEXT NOT NULL,
    tipo TEXT,
    estado TEXT DEFAULT 'Activo'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS ordenes_trabajo (
    id TEXT PRIMARY KEY,
    ticket TEXT,
    cliente_id INTEGER,
    tipo TEXT NOT NULL,
    estado TEXT NOT NULL,
    asignado_a INTEGER,
    titulo TEXT NOT NULL,
    notas TEXT,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(cliente_id) REFERENCES clientes(id),
    FOREIGN KEY(asignado_a) REFERENCES usuarios(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS ordenes_guardia (
    id TEXT PRIMARY KEY,
    tecnico_id INTEGER NOT NULL,
    titulo TEXT NOT NULL,
    descripcion TEXT,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    estado TEXT DEFAULT 'pendiente',
    FOREIGN KEY(tecnico_id) REFERENCES usuarios(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS contratos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    fecha_inicio DATE,
    fecha_fin DATE,
    estado TEXT DEFAULT 'Activo',
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(cliente_id) REFERENCES clientes(id)
  )`);

  // Insertar datos iniciales (contraseñas encriptadas)
  const adminPass = bcrypt.hashSync('admin123', 10);
  const supervisorPass = bcrypt.hashSync('supervisor123', 10);
  const tecnicoPass = bcrypt.hashSync('tecnico123', 10);
  
  db.run(`INSERT OR IGNORE INTO usuarios (id, nombre, email, password_hash, rol, activo) 
          VALUES (1, 'Admin', 'admin@gmao.com', ?, 'admin', 1)`, [adminPass]);
  db.run(`INSERT OR IGNORE INTO usuarios (id, nombre, email, password_hash, rol, activo) 
          VALUES (2, 'Supervisor', 'supervisor@gmao.com', ?, 'supervisor', 1)`, [supervisorPass]);
  db.run(`INSERT OR IGNORE INTO usuarios (id, nombre, email, password_hash, rol, activo) 
          VALUES (3, 'Técnico 1', 'tecnico@gmao.com', ?, 'tecnico', 1)`, [tecnicoPass]);

  db.run(`INSERT OR IGNORE INTO clientes (id, nombre, contacto, telefono) VALUES (1, 'Renfe', 'contacto@renfe.com', '911234567')`);
  db.run(`INSERT OR IGNORE INTO clientes (id, nombre, contacto, telefono) VALUES (2, 'Deimos', 'info@deimos.com', '912345678')`);
  db.run(`INSERT OR IGNORE INTO clientes (id, nombre, contacto, telefono) VALUES (3, 'Inetum', 'soporte@inetum.com', '913456789')`);
  db.run(`INSERT OR IGNORE INTO clientes (id, nombre, contacto, telefono) VALUES (4, 'SPA', 'admin@spa.com', '914567890')`);
});

// AUTENTICACIÓN
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  db.get('SELECT * FROM usuarios WHERE email = ? AND activo = 1', [email], (err, row) => {
    if (err) return res.status(500).json({ error: 'Error en servidor' });
    if (row && bcrypt.compareSync(password, row.password_hash)) {
      res.json({ id: row.id, nombre: row.nombre, email: row.email, rol: row.rol });
    } else {
      res.status(401).json({ error: 'Email o contraseña inválida' });
    }
  });
});

// USUARIOS
app.get('/api/usuarios', (req, res) => {
  db.all('SELECT id, nombre, email, rol, activo FROM usuarios', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/usuarios', (req, res) => {
  const { nombre, email, password, rol } = req.body;
  if (!nombre || !email || !password) {
    return res.status(400).json({ error: 'Nombre, email y contraseña requeridos' });
  }
  
  const passwordHash = bcrypt.hashSync(password, 10);
  db.run('INSERT INTO usuarios (nombre, email, password_hash, rol, activo) VALUES (?, ?, ?, ?, 1)',
    [nombre, email, passwordHash, rol], function(err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.status(400).json({ error: 'El email ya está registrado' });
        }
        return res.status(500).json({ error: err.message });
      }
      res.json({ id: this.lastID, nombre, email, rol, activo: 1 });
    });
});

app.put('/api/usuarios/:id', (req, res) => {
  const { nombre, email, password, rol, activo } = req.body;
  
  if (password) {
    const passwordHash = bcrypt.hashSync(password, 10);
    db.run('UPDATE usuarios SET nombre = ?, email = ?, password_hash = ?, rol = ?, activo = ? WHERE id = ?',
      [nombre, email, passwordHash, rol, activo, req.params.id], (err) => {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'El email ya está registrado' });
          }
          return res.status(500).json({ error: err.message });
        }
        res.json({ id: req.params.id, nombre, email, rol, activo });
      });
  } else {
    db.run('UPDATE usuarios SET nombre = ?, email = ?, rol = ?, activo = ? WHERE id = ?',
      [nombre, email, rol, activo, req.params.id], (err) => {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'El email ya está registrado' });
          }
          return res.status(500).json({ error: err.message });
        }
        res.json({ id: req.params.id, nombre, email, rol, activo });
      });
  }
});

app.delete('/api/usuarios/:id', (req, res) => {
  db.run('DELETE FROM usuarios WHERE id = ?', [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// CLIENTES
app.get('/api/clientes', (req, res) => {
  db.all('SELECT * FROM clientes', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/clientes', (req, res) => {
  const { nombre, contacto, telefono } = req.body;
  db.run('INSERT INTO clientes (nombre, contacto, telefono) VALUES (?, ?, ?)',
    [nombre, contacto, telefono], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, nombre, contacto, telefono });
    });
});

app.put('/api/clientes/:id', (req, res) => {
  const { nombre, contacto, telefono } = req.body;
  db.run('UPDATE clientes SET nombre = ?, contacto = ?, telefono = ? WHERE id = ?',
    [nombre, contacto, telefono, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: req.params.id, nombre, contacto, telefono });
    });
});

app.delete('/api/clientes/:id', (req, res) => {
  db.run('DELETE FROM clientes WHERE id = ?', [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// CONTRATOS
app.get('/api/contratos', (req, res) => {
  db.all(`SELECT c.*, cl.nombre as cliente_nombre 
          FROM contratos c 
          LEFT JOIN clientes cl ON c.cliente_id = cl.id
          ORDER BY c.creado_en DESC`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/contratos', (req, res) => {
  const { cliente_id, nombre, descripcion, fecha_inicio, fecha_fin, estado } = req.body;
  db.run('INSERT INTO contratos (cliente_id, nombre, descripcion, fecha_inicio, fecha_fin, estado) VALUES (?, ?, ?, ?, ?, ?)',
    [cliente_id, nombre, descripcion, fecha_inicio, fecha_fin, estado || 'Activo'], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, cliente_id, nombre, descripcion, fecha_inicio, fecha_fin, estado: estado || 'Activo' });
    });
});

app.put('/api/contratos/:id', (req, res) => {
  const { cliente_id, nombre, descripcion, fecha_inicio, fecha_fin, estado } = req.body;
  db.run('UPDATE contratos SET cliente_id = ?, nombre = ?, descripcion = ?, fecha_inicio = ?, fecha_fin = ?, estado = ? WHERE id = ?',
    [cliente_id, nombre, descripcion, fecha_inicio, fecha_fin, estado, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: req.params.id, cliente_id, nombre, descripcion, fecha_inicio, fecha_fin, estado });
    });
});

app.delete('/api/contratos/:id', (req, res) => {
  db.run('DELETE FROM contratos WHERE id = ?', [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// INVENTARIO
app.get('/api/inventario', (req, res) => {
  db.all('SELECT * FROM inventario', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/inventario', (req, res) => {
  const { contrato, zona, equipo, tipo, estado } = req.body;
  db.run('INSERT INTO inventario (contrato, zona, equipo, tipo, estado) VALUES (?, ?, ?, ?, ?)',
    [contrato, zona, equipo, tipo, estado || 'Activo'], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, contrato, zona, equipo, tipo, estado: estado || 'Activo' });
    });
});

app.put('/api/inventario/:id', (req, res) => {
  const { contrato, zona, equipo, tipo, estado } = req.body;
  db.run('UPDATE inventario SET contrato = ?, zona = ?, equipo = ?, tipo = ?, estado = ? WHERE id = ?',
    [contrato, zona, equipo, tipo, estado, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: req.params.id, contrato, zona, equipo, tipo, estado });
    });
});

app.delete('/api/inventario/:id', (req, res) => {
  db.run('DELETE FROM inventario WHERE id = ?', [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// ÓRDENES DE TRABAJO
app.get('/api/ordenes', (req, res) => {
  db.all(`SELECT o.*, c.nombre as cliente_nombre, u.nombre as tecnico_nombre 
          FROM ordenes_trabajo o 
          LEFT JOIN clientes c ON o.cliente_id = c.id
          LEFT JOIN usuarios u ON o.asignado_a = u.id
          ORDER BY o.creado_en DESC`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/ordenes', (req, res) => {
  const { ticket, cliente_id, tipo, estado, asignado_a, titulo, notas } = req.body;
  const id = `OT-${Date.now()}`;
  db.run('INSERT INTO ordenes_trabajo (id, ticket, cliente_id, tipo, estado, asignado_a, titulo, notas) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, ticket, cliente_id, tipo, estado, asignado_a, titulo, notas], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id, ticket, cliente_id, tipo, estado, asignado_a, titulo, notas });
    });
});

app.put('/api/ordenes/:id', (req, res) => {
  const { ticket, cliente_id, tipo, estado, asignado_a, titulo, notas } = req.body;
  db.run('UPDATE ordenes_trabajo SET ticket = ?, cliente_id = ?, tipo = ?, estado = ?, asignado_a = ?, titulo = ?, notas = ? WHERE id = ?',
    [ticket, cliente_id, tipo, estado, asignado_a, titulo, notas, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: req.params.id, ticket, cliente_id, tipo, estado, asignado_a, titulo, notas });
    });
});

app.delete('/api/ordenes/:id', (req, res) => {
  db.run('DELETE FROM ordenes_trabajo WHERE id = ?', [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// ÓRDENES DE GUARDIA
app.get('/api/guardia', (req, res) => {
  db.all(`SELECT og.*, u.nombre as tecnico_nombre 
          FROM ordenes_guardia og
          LEFT JOIN usuarios u ON og.tecnico_id = u.id
          ORDER BY og.creado_en DESC`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/guardia', (req, res) => {
  const { tecnico_id, titulo, descripcion } = req.body;
  const id = `GD-${Date.now()}`;
  db.run('INSERT INTO ordenes_guardia (id, tecnico_id, titulo, descripcion) VALUES (?, ?, ?, ?)',
    [id, tecnico_id, titulo, descripcion], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id, tecnico_id, titulo, descripcion, creado_en: new Date(), estado: 'pendiente' });
    });
});

app.put('/api/guardia/:id', (req, res) => {
  const { estado } = req.body;
  db.run('UPDATE ordenes_guardia SET estado = ? WHERE id = ?',
    [estado, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: req.params.id, estado });
    });
});

// Servir archivos estáticos
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✓ Servidor GMAO ejecutándose en http://localhost:${PORT}`);
});
