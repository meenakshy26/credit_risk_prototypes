/**
 * PRD §3.1 rule 5 and §5.2 rule 3. Two distinct kinds of driver, deliberately
 * tagged, because they mean opposite things for a borrower:
 *
 *   upstream — the input the commodity is made from. Rising upstream price
 *              means this borrower's cost is about to rise (§6 pressure rule).
 *   ceiling  — a substitute whose price caps what the borrower can charge.
 *              Cheap palm oil holds mustard oil down; it is not a cost.
 *   material — what a manufactured item is physically made of, used for PROXY
 *              rows where WPI has no item (tin containers -> CR coils).
 */
export const SEED_DRIVERS = [
  { commodityKey: 'rice_non_basmati', driverCode: '1101010101', kind: 'upstream', note: 'Paddy is the miller input; MSP-administered so it steps at announcements, not gradually.' },
  { commodityKey: 'rice_broken', driverCode: '1101010101', kind: 'upstream', note: 'Same paddy input.' },
  { commodityKey: 'wheat_flour', driverCode: '1101010102', kind: 'upstream', note: 'Wheat is the miller input.' },
  { commodityKey: 'mustard_oil', driverCode: '1102020002', kind: 'upstream', note: 'Seed is ~97% of a crushing mill cost.' },
  { commodityKey: 'mustard_oil_cake', driverCode: '1102020002', kind: 'upstream', note: 'Joint product of the same seed crush.' },
  { commodityKey: 'palm_oil_ceiling', driverCode: '1301040007', kind: 'ceiling', note: 'Imported palm oil caps domestic edible-oil realisations.' },

  { commodityKey: 'hr_coils', driverCode: '1103010005', kind: 'upstream', note: 'Iron ore moves 1-2 months before finished steel.' },
  { commodityKey: 'hr_plates', driverCode: '1103010005', kind: 'upstream', note: 'Iron ore moves 1-2 months before finished steel.' },
  { commodityKey: 'cr_coils', driverCode: '1103010005', kind: 'upstream', note: 'Iron ore moves 1-2 months before finished steel.' },
  { commodityKey: 'zinc_coated_steel', driverCode: '1103010005', kind: 'upstream', note: 'Plain steel plus zinc; ore leads the steel half.' },
  { commodityKey: 'steel_bars_rods', driverCode: '1314010027', kind: 'upstream', note: 'Induction-furnace rerollers melt scrap, not ore.' },

  { commodityKey: 'metal_containers', driverCode: '1314010012', kind: 'material', note: 'Tins are pressed from flat cold-rolled steel.' },
  { commodityKey: 'paper_packaging', driverCode: '1308010001', kind: 'material', note: 'Cartons are made from paper and board.' },
];

/**
 * Maps a WPI code to its driver key. Longest match wins, so an Item-level
 * entry overrides a group-level prefix.
 */
export const DRIVER_KEY_BY_CODE = Object.freeze({
  '1301060004': 'rice_non_basmati',
  '1301060002': 'rice_broken',
  '1301040002': 'mustard_oil',
  '1301040012': 'mustard_oil',
  '1301140005': 'mustard_oil_cake',
  '1314010010': 'hr_coils',
  '1314010011': 'hr_plates',
  '1314010012': 'cr_coils',
  '1314010014': 'steel_bars_rods',
  '1315060001': 'zinc_coated_steel',
  '1315020000': 'metal_containers',
  '1308020002': 'paper_packaging',
});

export function driverKeyForCode(code) {
  return DRIVER_KEY_BY_CODE[code] ?? null;
}
