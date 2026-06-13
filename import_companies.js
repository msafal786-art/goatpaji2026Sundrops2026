const db = require('./db');

const companies = [
  { name: 'SANT TRANS INC',         address: '5719 E Beck Ave Apt 201, Fresno, CA 93727', mc_number: '1692111',  dot_number: '4333224', phone: '(317) 444-8099', email: '', ein: '88-0900628' },
  { name: 'WMK STAR INC',           address: '2264 N Marks Ave Apt 256, Fresno, CA 93722', mc_number: '1336665', dot_number: '3757961', phone: '', email: '', ein: '87-3407539' },
  { name: 'MAMBA TRANS INC',        address: '14265 Terra Bella St Unit 40, Panorama City, CA 91402', mc_number: '1272016', dot_number: '3669706', phone: '', email: '', ein: '87-1339628' },
  { name: 'MULTANI ROAD KING INC',  address: '123-10 Sutter Ave, S Ozone Park, NY 11420',  mc_number: '',        dot_number: '', phone: '', email: '', ein: '' },
  { name: 'RAJPURA EXPRESS INC',    address: '30 Hedge Ln, Lancaster, NY 14086',            mc_number: '',        dot_number: '', phone: '863-821-5541', email: '', ein: '' },
  { name: 'R&B ROADLINE INC',       address: '2525 N Bourbon St Unit H2, Orange, CA 92865',mc_number: '',        dot_number: '', phone: '', email: '', ein: '' },
  { name: 'TAMBEKAR TRUCKS INC',    address: '1481 Green Spring Way, Greenwood, IN 46143',  mc_number: '',        dot_number: '', phone: '', email: '', ein: '' },
  { name: 'BROTHERS LOGISTICS INC', address: '161 Hilltop Farms Blvd, Whiteland, IN 46184',mc_number: '1467542', dot_number: '', phone: '317-584-7796', email: '', ein: '92-1208235' },
  { name: 'CHEEMA BROS TRANS INC',  address: '5813 Tanya Way, Keyes, CA 95328',             mc_number: '1369475', dot_number: '3802902', phone: '', email: '', ein: '' },
  { name: 'DSA TRANSPORTATION LLC', address: '305 N Jackson St, Kennett, MO 63857',         mc_number: '1063251', dot_number: '', phone: '573-717-5708', email: '', ein: '' },
  { name: 'THE FRONTLINE FREIGHT INC', address: '7411 Sundance Dr Apt 1321, Indianapolis, IN 46237', mc_number: '1361655', dot_number: '', phone: '', email: '', ein: '87-4204750' },
  { name: 'HIND INTRADE INC',       address: '2 Johnson St Apt 1, Carteret, NJ 07008',      mc_number: '',        dot_number: '', phone: '', email: '', ein: '' },
  { name: 'JAGAIT BROS INC',        address: '400 White Ln Apt 66, Bakersfield, CA 93307',  mc_number: '',        dot_number: '', phone: '', email: '', ein: '' },
  { name: 'KPT ROADLINE INC',       address: 'Modesto, CA',                                  mc_number: '1370237', dot_number: '3803965', phone: '', email: '', ein: '' },
  { name: 'LEOPARD LOGISTICS INC',  address: '992 Barberry Dr, Greenwood, IN 46143',         mc_number: '1305915', dot_number: '', phone: '', email: '', ein: '87-2474569' },
  { name: 'MANILA TRANS INC',       address: '7315 Sandy Cove Way Apt 1116, Indianapolis, IN 46217', mc_number: '', dot_number: '', phone: '', email: '', ein: '' },
  { name: 'OTHI EXPRESS INC',       address: '2824 S Arlington Ave, Indianapolis, IN 46203', mc_number: '',        dot_number: '4333331', phone: '', email: '', ein: '' },
  { name: 'SIDHU CARRIER',          address: '',                                              mc_number: '',        dot_number: '', phone: '', email: '', ein: '' },
  { name: 'UNITED XPRESS LLC',      address: '161 Hilltop Farms Blvd, New Whiteland, IN 46184', mc_number: '',    dot_number: '3068191', phone: '', email: '', ein: '' },
  { name: 'BAAZ 108 TRANSPORT INC', address: '158 W Carlton Way Apt 107, Tracy, CA 95376',  mc_number: '',        dot_number: '', phone: '', email: '', ein: '' },
  { name: 'FFI TRUCKING',           address: '',                                              mc_number: '',        dot_number: '', phone: '', email: '', ein: '' },
  { name: 'INDEPENDENT / OTHER',    address: '',                                              mc_number: '',        dot_number: '', phone: '', email: '', ein: '' },
];

const upsert = db.prepare(`
  INSERT INTO companies (name, address, mc_number, dot_number, phone, email)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(name) DO UPDATE SET
    address    = excluded.address,
    mc_number  = excluded.mc_number,
    dot_number = excluded.dot_number,
    phone      = excluded.phone,
    email      = excluded.email
`);

for (const c of companies) {
  upsert.run(c.name, c.address, c.mc_number, c.dot_number, c.phone, c.email);
  console.log(`✓ ${c.name}`);
}
console.log(`\nDone — ${companies.length} companies upserted.`);
process.exit(0);
