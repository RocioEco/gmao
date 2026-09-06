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
    id_cliente TEXT,
    cliente_id INTEGER,
    tipo TEXT NOT NULL,
    estado TEXT NOT NULL,
    prioridad TEXT DEFAULT 'media',
    responsable_id INTEGER,
    asignado_a INTEGER,
    tecnicos_apoyo TEXT,
    titulo TEXT NOT NULL,
    notas TEXT,
    activo_id INTEGER,
    datos_json TEXT,
    fecha_programada DATE,
    fecha_cierre TIMESTAMP,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(cliente_id) REFERENCES clientes(id),
    FOREIGN KEY(asignado_a) REFERENCES usuarios(id),
    FOREIGN KEY(responsable_id) REFERENCES usuarios(id),
    FOREIGN KEY(activo_id) REFERENCES activos(id)
  )`);

  // Migración segura para bases de datos ya existentes (ignora error si la columna ya existe)
  db.run(`ALTER TABLE ordenes_trabajo ADD COLUMN activo_id INTEGER`, () => {});
  db.run(`ALTER TABLE ordenes_trabajo ADD COLUMN datos_json TEXT`, () => {});
  db.run(`ALTER TABLE ordenes_trabajo ADD COLUMN id_cliente TEXT`, () => {});
  db.run(`ALTER TABLE ordenes_trabajo ADD COLUMN prioridad TEXT DEFAULT 'media'`, () => {});
  db.run(`ALTER TABLE ordenes_trabajo ADD COLUMN tecnicos_apoyo TEXT`, () => {});
  db.run(`ALTER TABLE ordenes_trabajo ADD COLUMN fecha_programada DATE`, () => {});
  db.run(`ALTER TABLE ordenes_trabajo ADD COLUMN fecha_cierre TIMESTAMP`, () => {});
  db.run(`ALTER TABLE ordenes_trabajo ADD COLUMN responsable_id INTEGER`, () => {});

  db.run(`CREATE TABLE IF NOT EXISTS visitas (
    id TEXT PRIMARY KEY,
    orden_id TEXT NOT NULL,
    fecha DATE,
    tecnico_id INTEGER,
    hora_inicio TEXT,
    hora_fin TEXT,
    id_mantis TEXT,
    proyecto TEXT,
    descripcion TEXT,
    checklist_tipo TEXT,
    checklist_json TEXT,
    materiales_json TEXT,
    fotos_json TEXT,
    medio_ambiente_json TEXT,
    seguridad_json TEXT,
    desplazamientos_json TEXT,
    firma TEXT,
    firma_nombre TEXT,
    finalizado INTEGER DEFAULT 0,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(orden_id) REFERENCES ordenes_trabajo(id),
    FOREIGN KEY(tecnico_id) REFERENCES usuarios(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS materiales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER,
    tipo TEXT,
    descripcion TEXT NOT NULL,
    unidad TEXT DEFAULT 'ud',
    historial_json TEXT DEFAULT '[]',
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(cliente_id) REFERENCES clientes(id)
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
  db.all(`SELECT o.*, 
                 c.nombre as cliente_nombre, 
                 u.nombre as tecnico_nombre,
                 r.nombre as responsable_nombre,
                 a.nombre as activo_nombre,
                 a.tipo as activo_tipo,
                 e.nombre as emplazamiento_nombre,
                 z.nombre as zona_nombre,
                 (SELECT COUNT(*) FROM visitas v WHERE v.orden_id = o.id) as num_visitas,
                 (SELECT MAX(fecha) FROM visitas v WHERE v.orden_id = o.id) as ultima_visita
          FROM ordenes_trabajo o 
          LEFT JOIN clientes c ON o.cliente_id = c.id
          LEFT JOIN usuarios u ON o.asignado_a = u.id
          LEFT JOIN usuarios r ON o.responsable_id = r.id
          LEFT JOIN activos a ON o.activo_id = a.id
          LEFT JOIN emplazamientos e ON a.emplazamiento_id = e.id
          LEFT JOIN zonas z ON e.zona_id = z.id
          ORDER BY o.creado_en DESC`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/ordenes', (req, res) => {
  const { ticket, id_cliente, cliente_id, tipo, estado, prioridad, responsable_id, asignado_a, tecnicos_apoyo,
          titulo, notas, activo_id, datos_json, fecha_programada, fecha_cierre } = req.body;
  const id = `OT-${Date.now()}`;
  db.run(`INSERT INTO ordenes_trabajo (id, ticket, id_cliente, cliente_id, tipo, estado, prioridad, responsable_id, asignado_a, 
          tecnicos_apoyo, titulo, notas, activo_id, datos_json, fecha_programada, fecha_cierre) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, ticket, id_cliente, cliente_id || null, tipo, estado, prioridad || 'media', responsable_id || null, asignado_a,
     tecnicos_apoyo || null, titulo, notas, activo_id || null, datos_json || null, fecha_programada || null, fecha_cierre || null],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id, ticket, id_cliente, cliente_id, tipo, estado, prioridad, responsable_id, asignado_a, tecnicos_apoyo, titulo, notas, activo_id, datos_json, fecha_programada, fecha_cierre });
    });
});

app.put('/api/ordenes/:id', (req, res) => {
  const { ticket, id_cliente, cliente_id, tipo, estado, prioridad, responsable_id, asignado_a, tecnicos_apoyo,
          titulo, notas, activo_id, datos_json, fecha_programada, fecha_cierre } = req.body;
  db.run(`UPDATE ordenes_trabajo SET ticket = ?, id_cliente = ?, cliente_id = ?, tipo = ?, estado = ?, prioridad = ?, 
          responsable_id = ?, asignado_a = ?, tecnicos_apoyo = ?, titulo = ?, notas = ?, activo_id = ?, datos_json = ?, 
          fecha_programada = ?, fecha_cierre = ? WHERE id = ?`,
    [ticket, id_cliente, cliente_id || null, tipo, estado, prioridad || 'media', responsable_id || null, asignado_a, tecnicos_apoyo || null,
     titulo, notas, activo_id || null, datos_json || null, fecha_programada || null, fecha_cierre || null, req.params.id],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: req.params.id, ticket, id_cliente, cliente_id, tipo, estado, prioridad, responsable_id, asignado_a, tecnicos_apoyo, titulo, notas, activo_id, datos_json, fecha_programada, fecha_cierre });
    });
});

app.delete('/api/ordenes/:id', (req, res) => {
  db.run('DELETE FROM visitas WHERE orden_id = ?', [req.params.id], () => {
    db.run('DELETE FROM ordenes_trabajo WHERE id = ?', [req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
  });
});

// VISITAS (revisiones/ejecuciones dentro de una OT)
app.get('/api/visitas', (req, res) => {
  const { orden_id } = req.query;
  let sql = `SELECT v.*, u.nombre as tecnico_nombre FROM visitas v LEFT JOIN usuarios u ON v.tecnico_id = u.id`;
  const params = [];
  if (orden_id) { sql += ' WHERE v.orden_id = ?'; params.push(orden_id); }
  sql += ' ORDER BY v.fecha DESC, v.creado_en DESC';
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/visitas', (req, res) => {
  const { orden_id, fecha, tecnico_id, hora_inicio, hora_fin, id_mantis, proyecto, descripcion,
          checklist_tipo, checklist_json, materiales_json, fotos_json, medio_ambiente_json,
          seguridad_json, desplazamientos_json, firma, firma_nombre, finalizado } = req.body;
  if (!orden_id) return res.status(400).json({ error: 'orden_id requerido' });
  const id = `VIS-${Date.now()}`;
  db.run(`INSERT INTO visitas (id, orden_id, fecha, tecnico_id, hora_inicio, hora_fin, id_mantis, proyecto, 
          descripcion, checklist_tipo, checklist_json, materiales_json, fotos_json, medio_ambiente_json, 
          seguridad_json, desplazamientos_json, firma, firma_nombre, finalizado) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, orden_id, fecha, tecnico_id, hora_inicio, hora_fin, id_mantis, proyecto, descripcion,
     checklist_tipo, checklist_json, materiales_json, fotos_json, medio_ambiente_json,
     seguridad_json, desplazamientos_json, firma, firma_nombre, finalizado ? 1 : 0],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      // Si la visita finaliza el trabajo, marcamos la OT como resuelta
      if (finalizado) {
        db.run(`UPDATE ordenes_trabajo SET estado = 'resuelta', fecha_cierre = CURRENT_TIMESTAMP WHERE id = ?`, [orden_id]);
      } else {
        db.run(`UPDATE ordenes_trabajo SET estado = 'en_curso' WHERE id = ? AND estado = 'abierta'`, [orden_id]);
      }
      res.json({ id, orden_id, fecha, tecnico_id, hora_inicio, hora_fin, id_mantis, proyecto, descripcion,
        checklist_tipo, checklist_json, materiales_json, fotos_json, medio_ambiente_json,
        seguridad_json, desplazamientos_json, firma, firma_nombre, finalizado: finalizado ? 1 : 0 });
    });
});

app.put('/api/visitas/:id', (req, res) => {
  const { fecha, tecnico_id, hora_inicio, hora_fin, id_mantis, proyecto, descripcion,
          checklist_tipo, checklist_json, materiales_json, fotos_json, medio_ambiente_json,
          seguridad_json, desplazamientos_json, firma, firma_nombre, finalizado, orden_id } = req.body;
  db.run(`UPDATE visitas SET fecha = ?, tecnico_id = ?, hora_inicio = ?, hora_fin = ?, id_mantis = ?, 
          proyecto = ?, descripcion = ?, checklist_tipo = ?, checklist_json = ?, materiales_json = ?, 
          fotos_json = ?, medio_ambiente_json = ?, seguridad_json = ?, desplazamientos_json = ?, 
          firma = ?, firma_nombre = ?, finalizado = ? WHERE id = ?`,
    [fecha, tecnico_id, hora_inicio, hora_fin, id_mantis, proyecto, descripcion, checklist_tipo,
     checklist_json, materiales_json, fotos_json, medio_ambiente_json, seguridad_json,
     desplazamientos_json, firma, firma_nombre, finalizado ? 1 : 0, req.params.id],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      if (orden_id) {
        if (finalizado) {
          db.run(`UPDATE ordenes_trabajo SET estado = 'resuelta', fecha_cierre = CURRENT_TIMESTAMP WHERE id = ?`, [orden_id]);
        } else {
          db.run(`UPDATE ordenes_trabajo SET estado = 'en_curso' WHERE id = ? AND estado = 'abierta'`, [orden_id]);
        }
      }
      res.json({ id: req.params.id, ...req.body });
    });
});

app.delete('/api/visitas/:id', (req, res) => {
  db.run('DELETE FROM visitas WHERE id = ?', [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// MATERIALES (PRECIARIO)
app.get('/api/materiales', (req, res) => {
  db.all(`SELECT m.*, c.nombre as cliente_nombre FROM materiales m 
          LEFT JOIN clientes c ON m.cliente_id = c.id ORDER BY m.descripcion`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/materiales', (req, res) => {
  const { cliente_id, tipo, descripcion, unidad, precio } = req.body;
  if (!descripcion) return res.status(400).json({ error: 'Descripción requerida' });
  const historial = precio !== undefined && precio !== '' ? [{ fecha: new Date().toISOString().slice(0, 10), precio: parseFloat(precio) }] : [];
  db.run(`INSERT INTO materiales (cliente_id, tipo, descripcion, unidad, historial_json) VALUES (?, ?, ?, ?, ?)`,
    [cliente_id || null, tipo, descripcion, unidad || 'ud', JSON.stringify(historial)], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, cliente_id, tipo, descripcion, unidad, historial_json: JSON.stringify(historial) });
    });
});

app.put('/api/materiales/:id', (req, res) => {
  const { cliente_id, tipo, descripcion, unidad } = req.body;
  db.run(`UPDATE materiales SET cliente_id = ?, tipo = ?, descripcion = ?, unidad = ? WHERE id = ?`,
    [cliente_id || null, tipo, descripcion, unidad, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: req.params.id, cliente_id, tipo, descripcion, unidad });
    });
});

app.post('/api/materiales/:id/precio', (req, res) => {
  const { precio, fecha } = req.body;
  if (precio === undefined || precio === '') return res.status(400).json({ error: 'Precio requerido' });
  db.get('SELECT historial_json FROM materiales WHERE id = ?', [req.params.id], (err, row) => {
    if (err || !row) return res.status(404).json({ error: 'Material no encontrado' });
    let historial = [];
    try { historial = JSON.parse(row.historial_json || '[]'); } catch { historial = []; }
    historial.push({ fecha: fecha || new Date().toISOString().slice(0, 10), precio: parseFloat(precio) });
    db.run('UPDATE materiales SET historial_json = ? WHERE id = ?', [JSON.stringify(historial), req.params.id], (err2) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ id: req.params.id, historial_json: JSON.stringify(historial) });
    });
  });
});

app.delete('/api/materiales/:id', (req, res) => {
  db.run('DELETE FROM materiales WHERE id = ?', [req.params.id], (err) => {
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
