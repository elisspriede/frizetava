'use strict';
// Izveido datubāzi ar demonstrācijas datiem (klienti, pieraksti), lai varētu apskatīt admin paneli.
// UZMANĪBU: pārraksta data/db.json. Palaid, kamēr serveris ir apturēts.
process.env.TZ = process.env.TZ || 'Europe/Riga';
const fs = require('fs');
const store = require('../lib/store');
const U = require('../lib/util');

if (fs.existsSync(store.FILE) && !process.argv.includes('--force')) {
  console.log(`Fails ${store.FILE} jau eksistē. Lai to pārrakstītu ar demo datiem, palaid: npm run demo -- --force`);
  process.exit(1);
}

let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = a => a[Math.floor(rnd() * a.length)];

const db = store.defaults();
store.createAdmin(db, 'admin', 'admin123');

const first = ['Anna', 'Laura', 'Elīza', 'Katrīna', 'Marta', 'Paula', 'Ieva', 'Sanita', 'Linda', 'Dace', 'Kristīne', 'Agnese', 'Jānis', 'Mārtiņš', 'Edgars', 'Rūta', 'Inese', 'Baiba', 'Zane', 'Evija', 'Andris', 'Līga', 'Sandra', 'Madara', 'Elza', 'Toms'];
const last = ['Bērziņa', 'Kalniņa', 'Ozola', 'Liepiņa', 'Krūmiņa', 'Zariņa', 'Eglīte', 'Vītola', 'Jansone', 'Priedīte', 'Lāce', 'Siliņa', 'Bērziņš', 'Kalniņš', 'Ozols', 'Grava', 'Pētersone', 'Klaviņa', 'Strazdiņa', 'Āboliņa', 'Liepiņš', 'Dūmiņa', 'Saulīte', 'Riekstiņa', 'Mežule', 'Vilks'];
const clients = first.map((f, i) => {
  const username = i === 0 ? 'anna' : (f.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + (i + 1));
  const { salt, hash } = U.hashPassword(i === 0 ? 'anna123' : 'demo1234');
  const created = new Date(Date.now() - Math.floor(rnd() * 150 + 1) * 864e5);
  return {
    id: U.uid('usr'), role: 'client', username, name: `${f} ${last[i]}`, phone: `+371 2${Math.floor(1000000 + rnd() * 8999999)}`,
    email: '', salt, hash, active: true, notes: i % 5 === 0 ? 'Jutīga galvas āda — saudzīgs šampūns.' : '', createdAt: created.toISOString()
  };
});
db.users.push(...clients);

const weights = [5, 4, 2, 3, 1, 2, 2, 1];
const wsum = weights.reduce((a, b) => a + b, 0);
const pickService = () => { let r = rnd() * wsum; for (let i = 0; i < weights.length; i++) { if ((r -= weights[i]) < 0) return db.services[i]; } return db.services[0]; };

const today = U.today();
for (let off = -90; off <= 16; off++) {
  const date = U.addDays(today, off);
  const h = db.hours[U.weekday(date)];
  if (!h.open) continue;
  const end = U.toMin(h.end);
  const bs = h.breakStart ? U.toMin(h.breakStart) : null, be = h.breakEnd ? U.toMin(h.breakEnd) : null;
  const fill = off < 0 ? 0.78 : off < 4 ? 0.7 : 0.4;
  let t = U.toMin(h.start);
  while (t < end) {
    if (rnd() > fill) { t += pick([15, 30, 45, 60]); continue; }
    const svc = pickService();
    const e = t + svc.duration;
    if (bs != null && t < be && e > bs) { t = be; continue; }
    if (e > end) break;
    const startTs = U.ts(date, t);
    let status = 'booked';
    if (startTs < Date.now()) { const r = rnd(); status = r < 0.06 ? 'cancelled' : r < 0.09 ? 'noshow' : 'completed'; }
    const client = rnd() < 0.12 ? null : pick(clients);
    db.bookings.push({
      id: U.uid('bkg'), userId: client ? client.id : null, guestName: client ? undefined : `${pick(first)} ${pick(last)}`, guestPhone: client ? undefined : '',
      serviceId: svc.id, serviceName: svc.name, date, start: U.fromMin(t), end: U.fromMin(e), price: svc.price, status, note: '',
      createdAt: new Date(startTs - Math.floor(rnd() * 14 + 1) * 864e5).toISOString(), createdBy: client ? 'client' : 'admin',
      cancelledBy: status === 'cancelled' ? 'client' : undefined
    });
    t = e + pick([0, 0, 15, 30]);
  }
}
// Annai — viens nākotnes pieraksts
const annaNext = db.bookings.find(b => b.status === 'booked' && b.date > U.addDays(today, 2));
if (annaNext) { annaNext.userId = clients[0].id; delete annaNext.guestName; delete annaNext.guestPhone; }

db.closures.push({ id: U.uid('cls'), date: U.addDays(today, 20), reason: 'Seminārs' });

fs.mkdirSync(store.DATA_DIR, { recursive: true });
fs.writeFileSync(store.FILE, JSON.stringify(db, null, 2));
console.log(`Demo dati izveidoti: ${db.users.length - 1} klienti, ${db.bookings.length} pieraksti.`);
console.log('Admin: admin / admin123    Klients: anna / anna123');
