/**
 * PRD Appendix — the three pilot profiles, to be migrated in Phase 1.
 *
 * Codes and roles are taken from the Appendix, not from the prototype's
 * "(example)" profiles, which carry extra rows the Appendix does not list.
 *
 * `label` is the borrower's own wording; `displayName` is the resolved
 * commodity name used in report prose. Values and shares are the figures the
 * PRD quotes in §1 and §7.2 — the cost block can only be sized against a
 * margin "where values are known", and these are the known ones.
 */
export const PILOT_PROFILES = [
  {
    name: 'Steel Trader',
    industry: 'iron & steel trader',
    importExposed: true,
    spreadName: 'trading spread',
    unitName: 'tonne',
    items: [
      { label: 'HR Coils', displayName: 'HR coils', role: 'STOCK', codes: ['1314010010'], driverCode: '1103010005', driverName: 'iron ore', note: 'Most policy-driven price on the sheet — a safeguard-duty lapse reverses stock value overnight.' },
      { label: 'CR Coils', displayName: 'CR coils', role: 'STOCK', codes: ['1314010012'], driverCode: '1103010005', driverName: 'iron ore', note: '' },
      { label: 'Bars & Rods', displayName: 'bars and rods', role: 'STOCK', codes: ['1314010014'], driverCode: '1314010027', driverName: 'steel scrap', note: 'Flat while other steel rises means builders are not buying — a demand warning.' },
      { label: 'Scrap', displayName: 'steel scrap', role: 'STOCK', codes: ['1314010027'], note: '' },
      { label: 'Iron Ore', displayName: 'iron ore', role: 'WATCH', codes: ['1103010005'], watchKind: 'upstream', note: "The mills' main cost — moves 1-2 months before steel." },
      { label: 'Coking Coal', displayName: 'coking coal', role: 'WATCH', codes: ['1201010100'], watchKind: 'upstream', note: 'The other mill cost, largely imported — same preview logic.' },
      { label: 'Fuel & Power', displayName: 'Fuel & Power', role: 'COST', codes: ['1200000000'], note: "The trader's freight bill." },
    ],
  },
  {
    name: 'N.K. Product',
    industry: 'mustard oil mill',
    importExposed: false,
    spreadName: 'crushing margin',
    unitName: 'quintal',
    items: [
      { label: 'Laha', displayName: 'Mustard seed', role: 'BUY', codes: ['1102020002'], valueInr: 46233876, share: 0.97, note: '97% of raw-material cost — this row is the cost side.' },
      { label: 'Mustard Oil', displayName: 'mustard oil', role: 'SELL', codes: ['1301040002', '1301040012'], note: 'Main product; WPI publishes it under two codes.' },
      { label: 'Khal', displayName: 'oil cake', role: 'SELL', codes: ['1301140005'], note: 'Second income — cushions a crushing squeeze.' },
      { label: 'Palm Oil', displayName: 'palm oil', role: 'WATCH', codes: ['1301040007'], watchKind: 'ceiling', note: 'Not a cost but a ceiling — cheap imported palm caps mustard-oil realisations.' },
      { label: 'Bardana', displayName: 'hessian', role: 'COST', codes: ['1304010008'], note: '' },
      { label: 'Empty Tin', displayName: 'Tin containers', role: 'COST', codes: ['1315020000'], isProxy: true, driverCode: '1314010012', driverName: 'CR coils', confidence: 'medium', note: 'PROXY: no WPI item for tin containers, so the nearest parent group. Tins are pressed from flat cold-rolled steel.' },
      { label: 'Fuel & Power', displayName: 'Fuel & Power', role: 'COST', codes: ['1200000000'], note: 'Electricity, freight and tanker movement.' },
    ],
  },
  {
    name: 'Aditya Rice',
    industry: 'rice trader',
    importExposed: false,
    grossMarginPct: 3.3,
    grossProfitInr: 17300000,
    spreadName: 'trading spread',
    unitName: 'quintal',
    items: [
      { label: 'Rice', displayName: 'rice', role: 'STOCK', codes: ['1301060004'], driverCode: '1101010101', driverName: 'paddy', valueInr: 495000000, note: 'Non-basmati — bought and sold. Margin is ~3%, so small price moves matter.' },
      { label: 'Broken Rice', displayName: 'broken rice', role: 'STOCK', codes: ['1301060002'], driverCode: '1101010101', driverName: 'paddy', note: 'Export-policy sensitive: a broken-rice export ban hits this price the same day.' },
      { label: 'Paddy', displayName: 'paddy', role: 'WATCH', codes: ['1101010101'], watchKind: 'upstream', note: "The millers' input — MSP-administered, so it steps at announcements and harvest." },
      { label: 'Freight & Diesel', displayName: 'Fuel & Power', role: 'COST', codes: ['1200000000'], valueInr: 12000000, note: 'Freight-heavy business — this row can eat the margin.' },
    ],
  },
];
