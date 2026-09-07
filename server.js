import express from 'express';
import sqlite3 from 'sqlite3';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';

const app = express();
const PORT = process.env.PORT || 3001;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Ruta de la base de datos: usa DB_PATH si está definida (para volumen persistente en Railway),
// si no, cae en el archivo local './gmao.db' (desarrollo).
const DB_PATH = process.env.DB_PATH || './gmao.db';
const dbDir = path.dirname(DB_PATH);
if (dbDir && dbDir !== '.' && !fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Inicializar base de datos SQLite
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error('Error al abrir BD:', err);
  else console.log(`Base de datos SQLite conectada en: ${DB_PATH}`);
});

// Helpers en forma de Promesa para poder usar async/await con sqlite3
function dbGet(sql, params = []) { return new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row))); }
function dbAll(sql, params = []) { return new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows))); }
function dbRun(sql, params = []) { return new Promise((resolve, reject) => db.run(sql, params, function (err) { err ? reject(err) : resolve(this); })); }

// Migración única: convierte el inventario de switches (tabla auxiliar "switches") en Activos reales
// del Cliente APA / Contrato SPA, con su Zona/Emplazamiento (incluyendo coordenadas GPS) y sus fotos.
// Solo se ejecuta si el Cliente "APA" todavía no existe (así nunca se duplica en despliegues posteriores).
// Registra los campos técnicos específicos de activos tipo "Switch" (Marca, S/N, IP, etc.).
// Se ejecuta siempre al arrancar (INSERT OR IGNORE), independientemente de si la migración
// de switches ya se hizo en un despliegue anterior.
async function registrarCamposSwitch() {
  try {
    const campos = [
      ['custom_marca', 'Marca', 'text', 80],
      ['custom_sn', 'S/N', 'text', 81],
      ['custom_ip', 'IP', 'text', 82],
      ['custom_mascara_red', 'Máscara de red', 'text', 83],
      ['custom_puerta_enlace', 'Puerta de enlace', 'text', 84],
      ['custom_mac', 'MAC', 'text', 85]
    ];
    for (const [clave, etiqueta, tipo, orden] of campos) {
      await dbRun(
        `INSERT OR IGNORE INTO campos_config (entidad, clave, etiqueta, tipo, es_sistema, visible, orden, tipo_activo) VALUES ('activo', ?, ?, ?, 0, 1, ?, 'Switch')`,
        [clave, etiqueta, tipo, orden]
      );
    }
  } catch (e) {
    console.error('Error registrando campos de Switch:', e.message);
  }
}

// Registra los campos técnicos específicos de activos tipo "Persiana Motorizada" (Tipo de lama, Motor),
// y oculta para ese tipo concreto los campos genéricos Fabricante/Modelo (que para persianas no aportan).
async function registrarCamposPersiana() {
  try {
    await dbRun(
      `INSERT OR IGNORE INTO campos_config (entidad, clave, etiqueta, tipo, es_sistema, visible, orden, tipo_activo) VALUES ('activo', 'custom_tipo_lama', 'Tipo de lama', 'text', 0, 1, 70, 'Persiana Motorizada')`
    );
    await dbRun(
      `INSERT OR IGNORE INTO campos_config (entidad, clave, etiqueta, tipo, es_sistema, visible, orden, tipo_activo) VALUES ('activo', 'custom_motor', 'Motor', 'text', 0, 1, 71, 'Persiana Motorizada')`
    );
    for (const clave of ['fabricante', 'modelo']) {
      const campo = await dbGet(`SELECT * FROM campos_config WHERE entidad = 'activo' AND clave = ?`, [clave]);
      if (!campo) continue;
      let excluidos = [];
      try { excluidos = JSON.parse(campo.ocultar_en_tipos || '[]'); } catch { excluidos = []; }
      if (!excluidos.includes('Persiana Motorizada')) {
        excluidos.push('Persiana Motorizada');
        await dbRun(`UPDATE campos_config SET ocultar_en_tipos = ? WHERE id = ?`, [JSON.stringify(excluidos), campo.id]);
      }
    }
  } catch (e) {
    console.error('Error registrando campos de Persiana:', e.message);
  }
}

async function migrarSwitchesAActivos() {
  try {
    const yaExiste = await dbGet(`SELECT id FROM clientes WHERE nombre = ?`, ['APA']);
    if (yaExiste) return;

    const switches = await dbAll(`SELECT * FROM switches`);
    if (!switches || switches.length === 0) return;

    const cliente = await dbRun(`INSERT INTO clientes (nombre) VALUES (?)`, ['APA']);
    const clienteId = cliente.lastID;

    const contrato = await dbRun(`INSERT INTO contratos (cliente_id, nombre, estado) VALUES (?, ?, 'Activo')`, [clienteId, 'SPA']);
    const contratoId = contrato.lastID;

    let zona = await dbGet(`SELECT id FROM zonas WHERE nombre = ?`, ['Avilés']);
    let zonaId;
    if (zona) zonaId = zona.id;
    else { const z = await dbRun(`INSERT INTO zonas (nombre) VALUES (?)`, ['Avilés']); zonaId = z.lastID; }

    await dbRun(`INSERT OR IGNORE INTO tipos_activo (nombre, checklist_json) VALUES (?, '[]')`, ['Switch']);

    await dbRun(`INSERT OR IGNORE INTO campos_config (entidad, clave, etiqueta, tipo, es_sistema, visible, orden) VALUES ('activo','custom_id_interno','ID Interno','text',0,1,89)`);
    await dbRun(`INSERT OR IGNORE INTO campos_config (entidad, clave, etiqueta, tipo, es_sistema, visible, orden) VALUES ('activo','custom_codigo_origen','Código','text',0,1,89.5)`);
    await dbRun(`INSERT OR IGNORE INTO campos_config (entidad, clave, etiqueta, tipo, es_sistema, visible, orden) VALUES ('activo','custom_reportado_por','Reportado por','text',0,1,90)`);
    await dbRun(`INSERT OR IGNORE INTO campos_config (entidad, clave, etiqueta, tipo, es_sistema, visible, orden) VALUES ('activo','custom_fecha_alta','Fecha de alta','date',0,1,91)`);
    await dbRun(`INSERT OR IGNORE INTO campos_config (entidad, clave, etiqueta, tipo, es_sistema, visible, orden) VALUES ('activo','custom_hora_alta','Hora de alta','text',0,1,92)`);

    for (const s of switches) {
      const emp = await dbRun(`INSERT INTO emplazamientos (zona_id, nombre, lat, lon) VALUES (?, ?, ?, ?)`, [zonaId, s.nombre, s.lat, s.lon]);
      const empId = emp.lastID;

      let fotosExtra = [];
      try { fotosExtra = JSON.parse(s.fotos_extra_json || '[]'); } catch { fotosExtra = []; }
      const fotos = [s.foto_interior, s.foto_exterior, ...fotosExtra].filter(Boolean);

      const camposExtra = JSON.stringify({
        custom_id_interno: s.id_interno || '',
        custom_codigo_origen: s.codigo || '',
        custom_reportado_por: s.reportado_por || '',
        custom_fecha_alta: s.fecha || '',
        custom_hora_alta: s.hora || ''
      });

      await dbRun(`INSERT INTO activos (emplazamiento_id, contrato_id, tipo, nombre, estado, observaciones, campos_extra, fotos_json)
                   VALUES (?, ?, 'Switch', ?, 'Activo', ?, ?, ?)`,
        [empId, contratoId, s.codigo || s.nombre, s.nota || '', camposExtra, JSON.stringify(fotos)]);
    }

    console.log(`✓ Migrados ${switches.length} switches a Activos (Cliente APA / Contrato SPA)`);
  } catch (e) {
    console.error('Error migrando switches a activos:', e.message);
  }
}

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
    telefono TEXT,
    campos_extra TEXT DEFAULT '{}'
  )`);
  db.run(`ALTER TABLE clientes ADD COLUMN campos_extra TEXT DEFAULT '{}'`, () => {});

  // ===== CAMPOS PERSONALIZABLES (Cliente / Contrato / Activo) =====
  db.run(`CREATE TABLE IF NOT EXISTS campos_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entidad TEXT NOT NULL,
    clave TEXT NOT NULL,
    etiqueta TEXT NOT NULL,
    tipo TEXT DEFAULT 'text',
    opciones TEXT DEFAULT '[]',
    es_sistema INTEGER DEFAULT 0,
    visible INTEGER DEFAULT 1,
    orden INTEGER DEFAULT 0,
    tipo_activo TEXT,
    ocultar_en_tipos TEXT DEFAULT '[]',
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(entidad, clave)
  )`);
  db.run(`ALTER TABLE campos_config ADD COLUMN tipo_activo TEXT`, () => {});
  db.run(`ALTER TABLE campos_config ADD COLUMN ocultar_en_tipos TEXT DEFAULT '[]'`, () => {});

  const seedCampo = (entidad, clave, etiqueta, tipo, orden, opciones) => {
    db.run(`INSERT OR IGNORE INTO campos_config (entidad, clave, etiqueta, tipo, opciones, es_sistema, visible, orden) VALUES (?, ?, ?, ?, ?, 1, 1, ?)`,
      [entidad, clave, etiqueta, tipo, JSON.stringify(opciones || []), orden]);
  };
  // Cliente
  seedCampo('cliente', 'contacto', 'Contacto (email)', 'text', 1);
  seedCampo('cliente', 'telefono', 'Teléfono', 'text', 2);
  // Contrato
  seedCampo('contrato', 'descripcion', 'Descripción', 'textarea', 1);
  seedCampo('contrato', 'fecha_inicio', 'Fecha Inicio', 'date', 2);
  seedCampo('contrato', 'fecha_fin', 'Fecha Fin', 'date', 3);
  seedCampo('contrato', 'estado', 'Estado', 'select', 4, ['Activo', 'Inactivo', 'Pausado']);
  // Activo (nota: "Tipo de Activo" no es configurable aquí porque determina el checklist de preventivo)
  seedCampo('activo', 'fabricante', 'Fabricante', 'text', 1);
  seedCampo('activo', 'modelo', 'Modelo', 'text', 2);
  seedCampo('activo', 'estado', 'Estado', 'select', 3, ['Activo', 'Inactivo', 'En reparación', 'Dado de baja']);
  seedCampo('activo', 'observaciones', 'Observaciones', 'textarea', 4);

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
    videos_json TEXT,
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

  db.run(`ALTER TABLE visitas ADD COLUMN videos_json TEXT`, () => {});

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

  // ===== INVENTARIO DE SWITCHES (SPA) =====
  db.run(`CREATE TABLE IF NOT EXISTS switches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    id_interno TEXT,
    codigo TEXT,
    nombre TEXT NOT NULL,
    tipo TEXT DEFAULT 'Switch',
    lat REAL,
    lon REAL,
    reportado_por TEXT,
    fecha DATE,
    hora TEXT,
    nota TEXT,
    foto_interior TEXT,
    foto_exterior TEXT,
    fotos_extra_json TEXT DEFAULT '[]',
    etiqueta_fotos_extra TEXT,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`ALTER TABLE switches ADD COLUMN id_interno TEXT`, () => {});

  // Carga automática (solo la primera vez, si la tabla está vacía) del inventario inicial de switches
  db.get('SELECT COUNT(*) as n FROM switches', (err, row) => {
    if (err) return;
    if (!row || row.n === 0) {
      const seedPath = path.join(__dirname, 'seed_switches.json');
      if (fs.existsSync(seedPath)) {
        try {
          const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
          const stmt = db.prepare(`INSERT INTO switches (id_interno, codigo, nombre, tipo, lat, lon, reportado_por, fecha, hora, nota, foto_interior, foto_exterior, fotos_extra_json, etiqueta_fotos_extra)
                                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
          seed.forEach(s => {
            stmt.run(s.id_interno, s.codigo, s.nombre, s.tipo || 'Switch', s.lat, s.lon, s.reportado_por, s.fecha, s.hora, s.nota,
              s.foto_interior, s.foto_exterior, JSON.stringify(s.fotos_extra || []), s.etiqueta_fotos_extra);
          });
          stmt.finalize(() => {
            console.log(`✓ Cargado inventario inicial de switches (${seed.length} registros)`);
            registrarCamposSwitch();
            registrarCamposPersiana();
            migrarSwitchesAActivos();
          });
          return;
        } catch (e) {
          console.error('Error cargando seed_switches.json:', e.message);
        }
      }
    }
    // Si la tabla switches ya tenía datos de un despliegue anterior (o no había seed que cargar),
    // igualmente comprobamos si falta migrarlos a Activos.
    registrarCamposSwitch();
    registrarCamposPersiana();
    migrarSwitchesAActivos();
  });

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
    campos_extra TEXT DEFAULT '{}',
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(cliente_id) REFERENCES clientes(id)
  )`);
  db.run(`ALTER TABLE contratos ADD COLUMN campos_extra TEXT DEFAULT '{}'`, () => {});

  db.run(`CREATE TABLE IF NOT EXISTS zonas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Migración: si la tabla zonas ya existe con la antigua columna contrato_id (versión previa
  // donde una Zona dependía incorrectamente de un Contrato), la recreamos sin esa columna,
  // preservando id/nombre/creado_en. Una Zona y un Emplazamiento son lugares físicos: pueden
  // contener activos de distintos clientes y contratos.
  db.all(`PRAGMA table_info(zonas)`, (err, cols) => {
    if (err) return;
    const tieneContratoId = cols.some(c => c.name === 'contrato_id');
    if (tieneContratoId) {
      db.serialize(() => {
        db.run(`ALTER TABLE zonas RENAME TO zonas_old_migracion`);
        db.run(`CREATE TABLE zonas (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nombre TEXT NOT NULL,
          creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        db.run(`INSERT INTO zonas (id, nombre, creado_en) SELECT id, nombre, creado_en FROM zonas_old_migracion`);
        db.run(`DROP TABLE zonas_old_migracion`, (err2) => {
          if (err2) console.error('Error al migrar tabla zonas:', err2);
          else console.log('✓ Migración: zonas ya no dependen de contrato_id');
        });
      });
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS emplazamientos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zona_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    direccion TEXT,
    lat REAL,
    lon REAL,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(zona_id) REFERENCES zonas(id)
  )`);
  db.run(`ALTER TABLE emplazamientos ADD COLUMN lat REAL`, () => {});
  db.run(`ALTER TABLE emplazamientos ADD COLUMN lon REAL`, () => {});

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
    campos_extra TEXT DEFAULT '{}',
    fotos_json TEXT DEFAULT '[]',
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(emplazamiento_id) REFERENCES emplazamientos(id),
    FOREIGN KEY(contrato_id) REFERENCES contratos(id)
  )`);
  db.run(`ALTER TABLE activos ADD COLUMN campos_extra TEXT DEFAULT '{}'`, () => {});
  db.run(`ALTER TABLE activos ADD COLUMN fotos_json TEXT DEFAULT '[]'`, () => {});

  db.run(`CREATE TABLE IF NOT EXISTS tipos_activo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT UNIQUE NOT NULL,
    checklist_json TEXT DEFAULT '[]',
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Checklists por defecto (idénticos a los que venían predefinidos en la app)
  const CHECKLIST_PUERTA = [
    { type: 'fields', title: 'Datos del Equipo', fields: [
      { key: 'fabricante', label: 'Fabricante', type: 'text' },
      { key: 'modelo', label: 'Modelo', type: 'text' },
      { key: 'cuadro_control', label: 'Cuadro de control', type: 'text' },
      { key: 'telemando', label: 'Telemando', type: 'select', options: ['Sí', 'No'] },
      { key: 'tipo_telemando', label: 'Tipo de telemando', type: 'text' },
      { key: 'ref_ubicacion', label: 'Referencia de ubicación', type: 'text' },
      { key: 'fecha_instalacion', label: 'Fecha instalación', type: 'date' },
      { key: 'anio_fabricacion', label: 'Año fabricación', type: 'text' },
      { key: 'dispositivos_seguridad', label: 'Dispositivos de seguridad', type: 'select', options: ['Sí', 'No'] },
      { key: 'tipo_dispositivo_seguridad', label: 'Tipo de dispositivo', type: 'text' },
      { key: 'finales_carrera', label: 'Finales de carrera', type: 'select', options: ['Sí', 'No'] },
      { key: 'tipo_finales_carrera', label: 'Tipo finales de carrera', type: 'text' }
    ]},
    { type: 'inspection', title: 'Inspección', grupos: [
      { titulo: 'Inspección', items: [
        'Comprobación visual', 'Control de estructura y fijaciones', 'Verificación de correcta apertura y cierre',
        'Comprobación de elementos de seguridad', 'Comprobación de finales de carrera',
        'Verificación de mecanismo de mando de emergencia', 'Lubricación de partes mecánicas'
      ]},
      { titulo: 'Limpieza y ajuste general de los mecanismos', items: [
        'Limpieza interior cajón mecanismo y revisión de sistema de fijación operador',
        'Limpieza y verificación estado perfil de rodadura',
        'Ajuste y revisión correa de tracción, piñones motor y poleas de transmisión',
        'Carros desplazamiento. Revisión tornillería y suspensiones hojas. Ajuste ruedas concéntricas/excéntricas. Revisión gomas.',
        'Repaso y ajuste tornillería de todos los elementos del operador. Revisión topes final de carrera.',
        'Inspección y sustitución de topes goma final carrera (si requiere)',
        'Inspección de grupo motor',
        'Inspección y cambio de ruedas concéntricas y excéntricas (si requiere)',
        'Inspección de carril de rodadura', 'Verificación, ajuste y ensayo'
      ]},
      { titulo: 'Ajuste y verificación de hojas y guías', items: [
        'Revisión y ajuste de hojas móviles. Verificación desplazamiento.',
        'Revisión, limpieza, engrase y fijación de guiadores, guías SOS y guías de seguridad.',
        'Cambio de guías (si requiere)'
      ]},
      { titulo: 'Verificación de conexiones eléctricas, elementos de seguridad y mando', items: [
        'Detectores magnéticos', 'Revisión y ensayo cerrojo interior. Comprobación de la holgura del cerrojo con pletinas cierre.',
        'Revisión y ensayo fotocélulas seguridad y/o apertura.', 'Revisión y ensayo selector de mando.',
        'Revisión y ensayo llave exterior/pulsadores/avisadores acústicos y conexiones a elementos externos',
        'Comprobación de automáticos diferenciales'
      ]},
      { titulo: 'Reglaje de parámetros y ensayo. Sistemas antipánico', items: [
        'Reglaje de rádares', 'Verificar y ajustar parámetros + autoajuste de la puerta',
        'Batería antipánico 24V. Comprobar carga. Ensayo y maniobra. (Si aplica)',
        'Cambio de la batería (si requiere)',
        'Antipánico puerta SOS. Ensayo de maniobra. Comprobar fuerza a aplicar abatibilidad de hojas.',
        'Antipánico mecánico CO-48. Revisión conexiones, poleas y caucho tracción. Ensayo de maniobra.'
      ]},
      { titulo: 'Telemando', items: [
        'Comprobación de apertura y cierre telemandado',
        'Comprobación de señales de estado (puerta abierta, cerrada, en tránsito)',
        'Verificación de cuadro de control de telemando', 'Conexión con autómata y test',
        'Comprobación de modos de funcionamiento (paso libre, bloqueo, sólo salida)',
        'Comprobación de interruptor de mando local de puerta'
      ]}
    ]}
  ];

  const CHECKLIST_PERSIANA = [
    { type: 'fields', title: 'Datos del Equipo', fields: [
      { key: 'tipo_lamas', label: 'Tipo de lamas', type: 'text' },
      { key: 'motor', label: 'Motor', type: 'text' },
      { key: 'telemando', label: 'Telemando', type: 'select', options: ['Sí', 'No'] },
      { key: 'tipo_telemando', label: 'Tipo de telemando', type: 'text' },
      { key: 'ref_ubicacion', label: 'Referencia de ubicación', type: 'text' },
      { key: 'fecha_instalacion', label: 'Fecha instalación', type: 'date' },
      { key: 'anio_fabricacion', label: 'Año fabricación', type: 'text' },
      { key: 'finales_carrera_adicionales', label: 'Finales de carrera adicionales', type: 'select', options: ['Sí', 'No'] },
      { key: 'tipo_finales_carrera_ad', label: 'Tipo (finales adicionales)', type: 'text' },
      { key: 'detectores_presencia', label: 'Detectores de presencia', type: 'select', options: ['Sí', 'No'] },
      { key: 'tipo_detectores', label: 'Tipo detectores', type: 'text' },
      { key: 'mecanismo_desbloqueo', label: 'Mecanismo desbloqueo emergencia', type: 'select', options: ['Sí', 'No'] },
      { key: 'tipo_mec_desbloqueo', label: 'Tipo mecanismo desbloqueo', type: 'text' }
    ]},
    { type: 'inspection', title: 'Inspección', grupos: [
      { titulo: 'Inspección', items: [
        'Comprobación visual', 'Control de estructura y fijaciones', 'Verificación de correcta apertura y cierre',
        'Comprobación de elementos de seguridad', 'Comprobación de finales de carrera',
        'Verificación de mecanismo de desbloqueo de emergencia', 'Revisión de cerradura, lubricación y limpieza'
      ]},
      { titulo: 'Limpieza y ajuste del cajón de la persiana', items: [
        'Limpieza interior cajón de la persiana y revisión del motor.',
        'Ajuste y revisión del eje del motor de la persiana.',
        'Revisión del estado del cojinete del eje de la persiana.',
        'Repaso y ajuste tornillería de todos los elementos del grupo motor.',
        'Estado de las tapas y chapas del exterior del cajón de la persiana.',
        'Revisión del cable del mecanismo de apertura manual de emergencia.',
        'Verificación de la existencia de manivela de apertura de emergencia.'
      ]},
      { titulo: 'Ajuste y verificación de las lamas', items: [
        'Revisión de los topes de las lamas de la persiana.',
        'Revisión del estado de la goma de la lama inferior de la persiana.',
        'Revisión de las lamas de la persiana.',
        'Revisión de los flejes de sujeción de las lamas al eje del motor.',
        'Limpieza, lubricación y verificación del estado de las guías y gomas.'
      ]},
      { titulo: 'Verificación de conexiones eléctricas, elementos de seguridad y mando', items: [
        'Revisión y ensayo del sistema de desbloqueo manual de emergencia.',
        'Revisión y ensayo del funcionamiento de los finales de carrera del motor.',
        'Revisión y ensayo del funcionamiento del motor (subir/bajar persiana).',
        'Revisión y ensayo del pulsador de la cerradura de la persiana.',
        'Revisión y ensayo de los pulsadores de subida y bajada del cuadro de control.',
        'Revisión y ensayo de los detectores de presencia de seguridad.'
      ]},
      { titulo: 'Telemando', items: [
        'Comprobación de apertura y cierre telemandado.',
        'Comprobación de señales de estado (abierta, cerrada, en tránsito).',
        'Verificación de cuadro de control de telemando.', 'Conexión con autómata y test.',
        'Comprobación del funcionamiento de los detectores de presencia.',
        'Comprobación de interruptor de mando local de la persiana.', 'Comprobación de relés.'
      ]}
    ]}
  ];

  const CHECKLIST_CCAA_VEHICULAR = [
    { type: 'grid', title: 'Barreras', rows: ['Entrada Ext', 'Entrada Int', 'Salida Ext', 'Salida Int'],
      columns: ['E. Físico', 'Motor/Red', 'Muelle', 'Engrase', 'Semáforo', 'Mástil', 'Fotocélulas', 'Leds', 'Detectores', 'Lazos', 'Conexiones'],
      options: ['ok', 'no ok', 'N/A'] },
    { type: 'grid', title: 'Rack', rows: ['Rack'],
      columns: ['E. Físico', 'Controlador', 'Diferenciales', 'SAI', 'Interfonía E', 'Interfonía S', 'Conexiones'],
      options: ['ok', 'no ok', 'N/A'] },
    { type: 'grid', title: 'Cámara OCR', rows: ['Entrada Ext', 'Salida Int'],
      columns: ['E. Físico', 'Fijación', 'Lectura', 'Conexiones'],
      options: ['ok', 'no ok', 'N/A'] },
    { type: 'textarea', title: 'Observaciones Generales', key: 'observaciones_generales' }
  ];

  const CHECKLIST_CCAA_PEATONAL = [
    { type: 'grid', title: 'Torno', rows: ['Torno'],
      columns: ['E. Físico', 'Controlador', 'Lector RFID', 'Lector QR', 'Engrase', 'Conexiones'],
      options: ['ok', 'no ok', 'N/A'] },
    { type: 'grid', title: 'Rack', rows: ['Rack'],
      columns: ['E. Físico', 'Controlador', 'Diferenciales', 'SAI', 'Interfonía E', 'Interfonía S', 'Conexiones'],
      options: ['ok', 'no ok', 'N/A'] },
    { type: 'grid', title: 'Portón', rows: ['Portón'],
      columns: ['E. Físico', 'Motor', 'Engrase'],
      options: ['ok', 'no ok', 'N/A'] },
    { type: 'textarea', title: 'Observaciones Generales', key: 'observaciones_generales' }
  ];

  const CHECKLIST_CCTV = [
    { type: 'fields', title: 'Datos de la Cámara', fields: [
      { key: 'estado_camara', label: 'Estado general cámara', type: 'select', options: ['OK', 'NO OK'] },
      { key: 'estado_cableado', label: 'Estado general cableado', type: 'select', options: ['OK', 'NO OK'] },
      { key: 'estado_soporte', label: 'Estado general soporte', type: 'select', options: ['OK', 'NO OK'] },
      { key: 'limpieza_camara', label: 'Limpieza de cámara realizada', type: 'select', options: ['SI', 'NO'] },
      { key: 'tratamiento_insectos', label: 'Tratamiento insectos realizado', type: 'select', options: ['SI', 'NO'] }
    ]},
    { type: 'textarea', title: 'Observaciones', key: 'observaciones' }
  ];

  const seedTipo = (nombre, checklist) => {
    db.run(`INSERT OR IGNORE INTO tipos_activo (nombre, checklist_json) VALUES (?, ?)`, [nombre, JSON.stringify(checklist)]);
  };
  seedTipo('Puerta Automática', CHECKLIST_PUERTA);
  seedTipo('Persiana Motorizada', CHECKLIST_PERSIANA);
  seedTipo('Control Acceso Vehicular', CHECKLIST_CCAA_VEHICULAR);
  seedTipo('Control Acceso Peatonal', CHECKLIST_CCAA_PEATONAL);
  seedTipo('CCTV', CHECKLIST_CCTV);
  seedTipo('Otro', []);

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
  const { nombre, contacto, telefono, campos_extra } = req.body;
  db.run('INSERT INTO clientes (nombre, contacto, telefono, campos_extra) VALUES (?, ?, ?, ?)',
    [nombre, contacto, telefono, campos_extra || '{}'], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, nombre, contacto, telefono, campos_extra: campos_extra || '{}' });
    });
});

app.put('/api/clientes/:id', (req, res) => {
  const { nombre, contacto, telefono, campos_extra } = req.body;
  db.run('UPDATE clientes SET nombre = ?, contacto = ?, telefono = ?, campos_extra = ? WHERE id = ?',
    [nombre, contacto, telefono, campos_extra || '{}', req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: req.params.id, nombre, contacto, telefono, campos_extra: campos_extra || '{}' });
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
  const { cliente_id, nombre, descripcion, fecha_inicio, fecha_fin, estado, campos_extra } = req.body;
  db.run('INSERT INTO contratos (cliente_id, nombre, descripcion, fecha_inicio, fecha_fin, estado, campos_extra) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [cliente_id, nombre, descripcion, fecha_inicio, fecha_fin, estado || 'Activo', campos_extra || '{}'], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, cliente_id, nombre, descripcion, fecha_inicio, fecha_fin, estado: estado || 'Activo', campos_extra: campos_extra || '{}' });
    });
});

app.put('/api/contratos/:id', (req, res) => {
  const { cliente_id, nombre, descripcion, fecha_inicio, fecha_fin, estado, campos_extra } = req.body;
  db.run('UPDATE contratos SET cliente_id = ?, nombre = ?, descripcion = ?, fecha_inicio = ?, fecha_fin = ?, estado = ?, campos_extra = ? WHERE id = ?',
    [cliente_id, nombre, descripcion, fecha_inicio, fecha_fin, estado, campos_extra || '{}', req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: req.params.id, cliente_id, nombre, descripcion, fecha_inicio, fecha_fin, estado, campos_extra: campos_extra || '{}' });
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
  db.all(`SELECT * FROM zonas ORDER BY nombre`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/zonas', (req, res) => {
  const { nombre } = req.body;
  if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
  db.run('INSERT INTO zonas (nombre) VALUES (?)',
    [nombre], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, nombre });
    });
});

app.put('/api/zonas/:id', (req, res) => {
  const { nombre } = req.body;
  db.run('UPDATE zonas SET nombre = ? WHERE id = ?',
    [nombre, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: req.params.id, nombre });
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
  db.all(`SELECT e.*, z.nombre as zona_nombre
          FROM emplazamientos e
          LEFT JOIN zonas z ON e.zona_id = z.id
          ORDER BY e.nombre`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/emplazamientos', (req, res) => {
  const { zona_id, nombre, direccion, lat, lon } = req.body;
  if (!zona_id || !nombre) return res.status(400).json({ error: 'Zona y nombre requeridos' });
  db.run('INSERT INTO emplazamientos (zona_id, nombre, direccion, lat, lon) VALUES (?, ?, ?, ?, ?)',
    [zona_id, nombre, direccion, lat || null, lon || null], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, zona_id, nombre, direccion, lat, lon });
    });
});

app.put('/api/emplazamientos/:id', (req, res) => {
  const { zona_id, nombre, direccion, lat, lon } = req.body;
  db.run('UPDATE emplazamientos SET zona_id = ?, nombre = ?, direccion = ?, lat = ?, lon = ? WHERE id = ?',
    [zona_id, nombre, direccion, lat || null, lon || null, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: req.params.id, zona_id, nombre, direccion, lat, lon });
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
  const { emplazamiento_id, contrato_id, tipo, nombre, fabricante, modelo, estado, observaciones, campos_extra, fotos_json } = req.body;
  if (!emplazamiento_id || !contrato_id || !nombre) {
    return res.status(400).json({ error: 'Emplazamiento, contrato y nombre requeridos' });
  }
  db.run(`INSERT INTO activos (emplazamiento_id, contrato_id, tipo, nombre, fabricante, modelo, estado, observaciones, campos_extra, fotos_json) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [emplazamiento_id, contrato_id, tipo, nombre, fabricante, modelo, estado || 'Activo', observaciones, campos_extra || '{}', fotos_json || '[]'], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, emplazamiento_id, contrato_id, tipo, nombre, fabricante, modelo, estado: estado || 'Activo', observaciones, campos_extra: campos_extra || '{}', fotos_json: fotos_json || '[]' });
    });
});

app.put('/api/activos/:id', (req, res) => {
  const { emplazamiento_id, contrato_id, tipo, nombre, fabricante, modelo, estado, observaciones, campos_extra, fotos_json } = req.body;
  db.run(`UPDATE activos SET emplazamiento_id = ?, contrato_id = ?, tipo = ?, nombre = ?, fabricante = ?, 
          modelo = ?, estado = ?, observaciones = ?, campos_extra = ?, fotos_json = ? WHERE id = ?`,
    [emplazamiento_id, contrato_id, tipo, nombre, fabricante, modelo, estado, observaciones, campos_extra || '{}', fotos_json || '[]', req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: req.params.id, emplazamiento_id, contrato_id, tipo, nombre, fabricante, modelo, estado, observaciones, campos_extra: campos_extra || '{}', fotos_json: fotos_json || '[]' });
    });
});

app.delete('/api/activos/:id', (req, res) => {
  db.run('DELETE FROM activos WHERE id = ?', [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// CAMPOS PERSONALIZABLES (Cliente / Contrato / Activo)
app.get('/api/campos-config', (req, res) => {
  const { entidad } = req.query;
  let sql = 'SELECT * FROM campos_config';
  const params = [];
  if (entidad) { sql += ' WHERE entidad = ?'; params.push(entidad); }
  sql += ' ORDER BY entidad, orden, id';
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/campos-config', (req, res) => {
  const { entidad, etiqueta, tipo, opciones, tipo_activo } = req.body;
  if (!entidad || !etiqueta) return res.status(400).json({ error: 'Entidad y etiqueta requeridos' });
  const clave = 'custom_' + etiqueta.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') + '_' + Date.now();
  db.run(`INSERT INTO campos_config (entidad, clave, etiqueta, tipo, opciones, es_sistema, visible, orden, tipo_activo) VALUES (?, ?, ?, ?, ?, 0, 1, 999, ?)`,
    [entidad, clave, etiqueta, tipo || 'text', JSON.stringify(opciones || []), tipo_activo || null], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, entidad, clave, etiqueta, tipo: tipo || 'text', opciones: JSON.stringify(opciones || []), es_sistema: 0, visible: 1, tipo_activo: tipo_activo || null });
    });
});

app.put('/api/campos-config/:id', (req, res) => {
  const { etiqueta, tipo, opciones, visible, orden, ocultar_en_tipos } = req.body;
  db.get('SELECT * FROM campos_config WHERE id = ?', [req.params.id], (err, campo) => {
    if (err || !campo) return res.status(404).json({ error: 'Campo no encontrado' });
    // Los campos de sistema solo permiten cambiar etiqueta/visible/orden/ocultar_en_tipos (no tipo/opciones, para no romper el resto de la app)
    const nuevoTipo = campo.es_sistema ? campo.tipo : (tipo || campo.tipo);
    const nuevasOpciones = campo.es_sistema ? campo.opciones : JSON.stringify(opciones || []);
    const nuevoOcultarEnTipos = ocultar_en_tipos !== undefined ? JSON.stringify(ocultar_en_tipos) : campo.ocultar_en_tipos;
    db.run(`UPDATE campos_config SET etiqueta = ?, tipo = ?, opciones = ?, visible = ?, orden = ?, ocultar_en_tipos = ? WHERE id = ?`,
      [etiqueta ?? campo.etiqueta, nuevoTipo, nuevasOpciones, visible !== undefined ? (visible ? 1 : 0) : campo.visible, orden !== undefined ? orden : campo.orden, nuevoOcultarEnTipos, req.params.id],
      (err2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json({ success: true });
      });
  });
});

app.delete('/api/campos-config/:id', (req, res) => {
  db.get('SELECT * FROM campos_config WHERE id = ?', [req.params.id], (err, campo) => {
    if (err || !campo) return res.status(404).json({ error: 'Campo no encontrado' });
    if (campo.es_sistema) return res.status(400).json({ error: 'Los campos de sistema no se pueden eliminar, solo ocultar' });
    db.run('DELETE FROM campos_config WHERE id = ?', [req.params.id], (err2) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ success: true });
    });
  });
});

// VIGÍA DE NOTIFICACIONES: guardias pendientes (endpoint ligero, sin joins pesados)
app.get('/api/guardias-pendientes', (req, res) => {
  db.all(`SELECT o.id, o.titulo, o.creado_en, u.nombre as tecnico_nombre
          FROM ordenes_trabajo o
          LEFT JOIN usuarios u ON o.asignado_a = u.id
          WHERE o.tipo = 'guardia'
          ORDER BY o.creado_en DESC`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// TIPOS DE ACTIVO Y SUS CHECKLISTS
app.get('/api/tipos-activo', (req, res) => {
  db.all('SELECT * FROM tipos_activo ORDER BY nombre', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/tipos-activo', (req, res) => {
  const { nombre, checklist_json } = req.body;
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  db.run('INSERT INTO tipos_activo (nombre, checklist_json) VALUES (?, ?)',
    [nombre.trim(), checklist_json || '[]'], function(err) {
      if (err) {
        if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Ya existe un tipo con ese nombre' });
        return res.status(500).json({ error: err.message });
      }
      res.json({ id: this.lastID, nombre: nombre.trim(), checklist_json: checklist_json || '[]' });
    });
});

app.put('/api/tipos-activo/:id', (req, res) => {
  const { nombre, checklist_json } = req.body;
  db.run('UPDATE tipos_activo SET nombre = ?, checklist_json = ? WHERE id = ?',
    [nombre, checklist_json, req.params.id], (err) => {
      if (err) {
        if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Ya existe un tipo con ese nombre' });
        return res.status(500).json({ error: err.message });
      }
      res.json({ id: req.params.id, nombre, checklist_json });
    });
});

app.delete('/api/tipos-activo/:id', (req, res) => {
  db.run('DELETE FROM tipos_activo WHERE id = ?', [req.params.id], (err) => {
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
          checklist_tipo, checklist_json, materiales_json, fotos_json, videos_json, medio_ambiente_json,
          seguridad_json, desplazamientos_json, firma, firma_nombre, finalizado } = req.body;
  if (!orden_id) return res.status(400).json({ error: 'orden_id requerido' });
  const id = `VIS-${Date.now()}`;
  db.run(`INSERT INTO visitas (id, orden_id, fecha, tecnico_id, hora_inicio, hora_fin, id_mantis, proyecto, 
          descripcion, checklist_tipo, checklist_json, materiales_json, fotos_json, videos_json, medio_ambiente_json, 
          seguridad_json, desplazamientos_json, firma, firma_nombre, finalizado) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, orden_id, fecha, tecnico_id, hora_inicio, hora_fin, id_mantis, proyecto, descripcion,
     checklist_tipo, checklist_json, materiales_json, fotos_json, videos_json, medio_ambiente_json,
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
        checklist_tipo, checklist_json, materiales_json, fotos_json, videos_json, medio_ambiente_json,
        seguridad_json, desplazamientos_json, firma, firma_nombre, finalizado: finalizado ? 1 : 0 });
    });
});

app.put('/api/visitas/:id', (req, res) => {
  const { fecha, tecnico_id, hora_inicio, hora_fin, id_mantis, proyecto, descripcion,
          checklist_tipo, checklist_json, materiales_json, fotos_json, videos_json, medio_ambiente_json,
          seguridad_json, desplazamientos_json, firma, firma_nombre, finalizado, orden_id } = req.body;
  db.run(`UPDATE visitas SET fecha = ?, tecnico_id = ?, hora_inicio = ?, hora_fin = ?, id_mantis = ?, 
          proyecto = ?, descripcion = ?, checklist_tipo = ?, checklist_json = ?, materiales_json = ?, 
          fotos_json = ?, videos_json = ?, medio_ambiente_json = ?, seguridad_json = ?, desplazamientos_json = ?, 
          firma = ?, firma_nombre = ?, finalizado = ? WHERE id = ?`,
    [fecha, tecnico_id, hora_inicio, hora_fin, id_mantis, proyecto, descripcion, checklist_tipo,
     checklist_json, materiales_json, fotos_json, videos_json, medio_ambiente_json, seguridad_json,
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
