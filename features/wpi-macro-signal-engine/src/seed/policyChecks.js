/**
 * PRD §7.1 "Policy checks": what event would invalidate the price read.
 *
 * A WPI move is only a valid signal until a notification overrides it — a duty
 * cut, an export ban, an MSP change. The engine cannot read the news (out of
 * scope per §1), so it names the exact page a credit officer must check and
 * says what a change there would do to this borrower.
 *
 * Text is deliberately short: it renders as a mid-sentence clause in the report.
 */
export const SEED_POLICY_CHECKS = [
  { commodityKey: 'edible_oil', sortOrder: 10, text: 'CBIC edible-oil import duty (a duty cut caps oil prices and deepens the squeeze)', url: 'https://taxinformation.cbic.gov.in' },
  { commodityKey: 'mustard', sortOrder: 20, text: 'mustard MSP announcements', url: 'https://pib.gov.in/AllReleases.aspx' },
  { commodityKey: 'palm_oil', sortOrder: 30, text: 'palm-oil import prices (ceiling on domestic oil)', url: 'https://www.worldbank.org/en/research/commodity-markets' },
  { commodityKey: 'rabi_weather', sortOrder: 40, text: 'monsoon and rabi sowing reports (they set next season seed price)', url: 'https://mausam.imd.gov.in' },

  { commodityKey: 'rice_export', sortOrder: 10, text: 'DGFT rice export policy (an export ban would hit realisations overnight)', url: 'https://www.dgft.gov.in' },
  { commodityKey: 'paddy_msp', sortOrder: 20, text: 'FCI open-market sales', url: 'https://pib.gov.in/AllReleases.aspx' },
  { commodityKey: 'kharif_weather', sortOrder: 30, text: 'monsoon and kharif sowing progress', url: 'https://mausam.imd.gov.in' },

  { commodityKey: 'steel_duty', sortOrder: 10, text: 'DGTR safeguard and anti-dumping cases on steel (if the duty holding prices up lapses, stock value falls with it)', url: 'https://www.dgtr.gov.in' },
  { commodityKey: 'ore_coal_world', sortOrder: 20, text: 'world iron-ore and coking-coal prices, which lead India by 2-8 weeks', url: 'https://www.worldbank.org/en/research/commodity-markets' },

  { commodityKey: 'universal', sortOrder: 90, text: 'PIB releases naming these goods (duties, MSP, stock limits override every price read)', url: 'https://pib.gov.in/AllReleases.aspx' },
  { commodityKey: 'fx', sortOrder: 95, text: 'RBI reference rate (a rupee more than 5% weaker in 3 months upgrades every import-exposed flag)', url: 'https://www.rbi.org.in/Scripts/BS_DisplayReferenceRate.aspx' },
];

/**
 * Which policy keys a WPI code pulls in. Prefix-matched against the 10-digit
 * hierarchy so a new borrower in a covered commodity family inherits the right
 * checklist without anyone editing a profile.
 */
const POLICY_KEYS_BY_PREFIX = [
  { prefix: '1301040', keys: ['edible_oil'] },
  { prefix: '1301040007', keys: ['palm_oil'] },
  { prefix: '1102020002', keys: ['mustard', 'rabi_weather'] },
  { prefix: '1301140005', keys: ['mustard'] },
  { prefix: '130106', keys: ['rice_export', 'paddy_msp'] },
  { prefix: '1101010101', keys: ['paddy_msp', 'kharif_weather'] },
  { prefix: '131401', keys: ['steel_duty'] },
  { prefix: '131506', keys: ['steel_duty'] },
  { prefix: '1103010005', keys: ['ore_coal_world'] },
  { prefix: '1201010100', keys: ['ore_coal_world'] },
];

export function policyKeysForCodes(codes, { importExposed = false } = {}) {
  const keys = new Set(['universal']);
  for (const code of codes) {
    for (const { prefix, keys: k } of POLICY_KEYS_BY_PREFIX) {
      if (code.startsWith(prefix)) k.forEach((x) => keys.add(x));
    }
  }
  if (importExposed) keys.add('fx');
  return [...keys];
}
