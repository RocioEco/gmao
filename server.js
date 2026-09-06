
/


























Server · JS
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
 
  db.run(`CREATE TABLE IF NOT EXISTS zonas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contrato_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(contrato_id) REFERENCES contratos(id)
  )`);
 
  db.run(`CREATE TABLE IF NOT EXISTS emplazamientos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zona_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    direccion TEXT,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(zona_id) REFERENCES zonas(id)
  )`);
 
  db.run(`CREATE TABLE IF NOT EXISTS activos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    emplazamiento_id INTEGER NOT NULL,
    contrato_id INTEGER NOT NULL,
    tipo TEXT,
    nombre TEXT NOT NULL,
    fabricante TEXT,
    modelo TEXT,
    estado TEXT DEFAULT 'Activo',
    observaciones TEXT,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(emplazamiento_id) REFERENCES emplazamientos(id),
    FOREIGN KEY(contrato_id) REFERENCES contratos(id)
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
 
// ZONAS
app.get('/api/zonas', (req, res) => {
  db.all(`SELECT z.*, c.nombre as contrato_nombre, cl.id as cliente_id, cl.nombre as cliente_nombre
          FROM zonas z
          LEFT JOIN contratos c ON z.contrato_id = c.id
          LEFT JOIN clientes cl ON c.cliente_id = cl.id
          ORDER BY z.nombre`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});
 
app.post('/api/zonas', (req, res) => {
  const { contrato_id, nombre } = req.body;
  if (!contrato_id || !nombre) return res.status(400).json({ error: 'Contrato y nombre requeridos' });
  db.run('INSERT INTO zonas (contrato_id, nombre) VALUES (?, ?)',
    [contrato_id, nombre], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, contrato_id, nombre });
    });
});
 
app.put('/api/zonas/:id', (req, res) => {
  const { contrato_id, nombre } = req.body;
  db.run('UPDATE zonas SET contrato_id = ?, nombre = ? WHERE id = ?',
    [contrato_id, nombre, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: req.params.id, contrato_id, nombre });
    });
});
 
app.delete('/api/zonas/:id', (req, res) => {
  db.run('DELETE FROM zonas WHERE id = ?', [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});
 
// EMPLAZAMIENTOS
app.get('/api/emplazamientos', (req, res) => {
  db.all(`SELECT e.*, z.nombre as zona_nombre, c.id as contrato_id, c.nombre as contrato_nombre, 
                 cl.id as cliente_id, cl.nombre as cliente_nombre
          FROM emplazamientos e
          LEFT JOIN zonas z ON e.zona_id = z.id
          LEFT JOIN contratos c ON z.contrato_id = c.id
          LEFT JOIN clientes cl ON c.cliente_id = cl.id
          ORDER BY e.nombre`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});
 
app.post('/api/emplazamientos', (req, res) => {
  const { zona_id, nombre, direccion } = req.body;
  if (!zona_id || !nombre) return res.status(400).json({ error: 'Zona y nombre requeridos' });
  db.run('INSERT INTO emplazamientos (zona_id, nombre, direccion) VALUES (?, ?, ?)',
    [zona_id, nombre, direccion], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, zona_id, nombre, direccion });
    });
});
 
app.put('/api/emplazamientos/:id', (req, res) => {
  const { zona_id, nombre, direccion } = req.body;
  db.run('UPDATE emplazamientos SET zona_id = ?, nombre = ?, direccion = ? WHERE id = ?',
    [zona_id, nombre, direccion, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: req.params.id, zona_id, nombre, direccion });
    });
});
 
app.delete('/api/emplazamientos/:id', (req, res) => {
  db.run('DELETE FROM emplazamientos WHERE id = ?', [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});
 
// ACTIVOS
app.get('/api/activos', (req, res) => {
  db.all(`SELECT a.*, 
                 e.nombre as emplazamiento_nombre,
                 z.id as zona_id, z.nombre as zona_nombre,
                 c.nombre as contrato_nombre,
                 cl.id as cliente_id, cl.nombre as cliente_nombre
          FROM activos a
          LEFT JOIN emplazamientos e ON a.emplazamiento_id = e.id
          LEFT JOIN zonas z ON e.zona_id = z.id
          LEFT JOIN contratos c ON a.contrato_id = c.id
          LEFT JOIN clientes cl ON c.cliente_id = cl.id
          ORDER BY a.creado_en DESC`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});
 
app.post('/api/activos', (req, res) => {
  const { emplazamiento_id, contrato_id, tipo, nombre, fabricante, modelo, estado, observaciones } = req.body;
  if (!emplazamiento_id || !contrato_id || !nombre) {
    return res.status(400).json({ error: 'Emplazamiento, contrato y nombre requeridos' });
  }
  db.run(`INSERT INTO activos (emplazamiento_id, contrato_id, tipo, nombre, fabricante, modelo, estado, observaciones) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [emplazamiento_id, contrato_id, tipo, nombre, fabricante, modelo, estado || 'Activo', observaciones], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, emplazamiento_id, contrato_id, tipo, nombre, fabricante, modelo, estado: estado || 'Activo', observaciones });
    });
});
 
app.put('/api/activos/:id', (req, res) => {
  const { emplazamiento_id, contrato_id, tipo, nombre, fabricante, modelo, estado, observaciones } = req.body;
  db.run(`UPDATE activos SET emplazamiento_id = ?, contrato_id = ?, tipo = ?, nombre = ?, fabricante = ?, 
          modelo = ?, estado = ?, observaciones = ? WHERE id = ?`,
    [emplazamiento_id, contrato_id, tipo, nombre, fabricante, modelo, estado, observaciones, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: req.params.id, emplazamiento_id, contrato_id, tipo, nombre, fabricante, modelo, estado, observaciones });
    });
});
 
app.delete('/api/activos/:id', (req, res) => {
  db.run('DELETE FROM activos WHERE id = ?', [req.params.id], (err) => {
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
 
