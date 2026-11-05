'use strict';
const fs = require('fs');
const path = require('path');
const { hashPassword, uid } = require('./util');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');

const SERVICE_COLORS = ['#2E3A2F', '#6B7F5B', '#C96F4F', '#B08D63', '#8FA07E', '#A35A3F', '#4F6250', '#C9A98A'];

function defaults() {
  const svc = (name, description, duration, price, i) =>
    ({ id: uid('svc'), name, description, duration, price, active: true, color: SERVICE_COLORS[i % SERVICE_COLORS.length], order: i });
  return {
    version: 1,
    settings: {
      salonName: 'LD Studio',
      tagline: 'Griezumi, krāsošana un ieveidošana mierīgā, mājīgā vidē.',
      about: 'Mazs, mājīgs salons, kur katrs apmeklējums sākas ar sarunu. Strādāju ar profesionālu, saudzīgu kosmētiku un iesaku tikai to, kas tiešām piestāv tieši tev.',
      address: 'Brīvības iela 1, Rīga',
      phone: '+371 20 000 000',
      email: 'info@example.lv',
      instagram: '',
      whatsapp: 'https://wa.me/message/AIFQAWUAESGYL1',
      slotStep: 15,
      minAdvanceHours: 2,
      cancelHours: 12,
      bookingDaysAhead: 60,
      maxActiveBookings: 3,
      allowRegistration: true,
      allowGuestBooking: true
    },
    // 0 = svētdiena ... 6 = sestdiena
    hours: {
      0: { open: false, start: '10:00', end: '15:00', breakStart: '', breakEnd: '' },
      1: { open: true, start: '09:00', end: '18:00', breakStart: '13:00', breakEnd: '13:30' },
      2: { open: true, start: '09:00', end: '18:00', breakStart: '13:00', breakEnd: '13:30' },
      3: { open: true, start: '10:00', end: '19:00', breakStart: '14:00', breakEnd: '14:30' },
      4: { open: true, start: '09:00', end: '18:00', breakStart: '13:00', breakEnd: '13:30' },
      5: { open: true, start: '09:00', end: '17:00', breakStart: '', breakEnd: '' },
      6: { open: true, start: '10:00', end: '15:00', breakStart: '', breakEnd: '' }
    },
    closures: [],
    services: [
      svc('Sieviešu matu griezums', 'Konsultācija, mazgāšana, griezums un ieveidošana.', 60, 35, 0),
      svc('Vīriešu matu griezums', 'Klasisks vai moderns griezums ar mazgāšanu.', 30, 18, 1),
      svc('Bērnu matu griezums', 'Bērniem līdz 12 gadu vecumam.', 30, 12, 2),
      svc('Matu krāsošana', 'Vienā tonī, ar kopšanu un ieveidošanu.', 120, 70, 3),
      svc('Balayage / Airtouch', 'Dabiska, saulē izbalējusi krāsas pāreja.', 180, 120, 4),
      svc('Matu kopšanas procedūra', 'Dziļi atjaunojoša procedūra ar masāžu.', 45, 30, 5),
      svc('Ieveidošana', 'Viļņi, lokas vai gludi mati ikdienai.', 45, 25, 6),
      svc('Svētku frizūra', 'Frizūra kāzām, izlaidumam vai svētkiem.', 90, 55, 7)
    ],
    users: [],
    bookings: [],
    sessions: []
  };
}

function createAdmin(db, username, password) {
  const { salt, hash } = hashPassword(password);
  db.users.push({
    id: uid('usr'), role: 'admin', username, name: 'Administrators', phone: '', email: '',
    salt, hash, active: true, notes: '', createdAt: new Date().toISOString(),
    mustChangePassword: !process.env.ADMIN_PASS
  });
}

let db = null;

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const hosted = !!(process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production');
  if (hosted && !process.env.DATA_DIR) throw new Error('Publiskā vidē jānorāda DATA_DIR uz pastāvīgu disku (piem., /data), citādi dati pazudīs pie restarta.');
  if (fs.existsSync(FILE)) {
    db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const d = defaults();
    for (const k of Object.keys(d)) if (db[k] === undefined) db[k] = d[k];
    db.settings = { ...d.settings, ...db.settings };
    // vienreizēja pāreja: sākotnējais noklusējuma nosaukums → LD Studio (admina paša ievadītu nosaukumu nemaina)
    if (db.settings.salonName === 'Matu studija') { db.settings.salonName = 'LD Studio'; save(); console.log('  Salona nosaukums nomainīts uz LD Studio'); }
    // ja admins vēl nav mainījis noklusējuma paroli, bet ir uzdots ADMIN_PASS — piemēro to
    const a = db.users.find(u => u.role === 'admin' && u.mustChangePassword);
    if (a && process.env.ADMIN_PASS) { Object.assign(a, hashPassword(process.env.ADMIN_PASS)); a.mustChangePassword = false; save(); console.log('  Administratora parole iestatīta no ADMIN_PASS'); }
  } else {
    if (hosted && !process.env.ADMIN_PASS) throw new Error('Publiskā vidē pirms pirmās palaišanas jāiestata ADMIN_PASS.');
    db = defaults();
    const user = process.env.ADMIN_USER || 'admin';
    const pass = process.env.ADMIN_PASS || 'admin123';
    createAdmin(db, user, pass);
    save();
    console.log(`\n  Izveidota jauna datubāze: ${FILE}`);
    if (process.env.ADMIN_PASS) console.log(`  Administratora konts izveidots: ${user} (parole no ADMIN_PASS)\n`);
    else console.log(`  Administratora pieeja → lietotājvārds: ${user}  parole: ${pass}\n  Lūdzu nomaini paroli admin panelī (Iestatījumi).\n`);
  }
  return db;
}

function save() {
  const tmp = FILE + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, JSON.stringify(db)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, FILE);
}

module.exports = { load, save, defaults, createAdmin, FILE, DATA_DIR, SERVICE_COLORS, get db() { return db; } };
