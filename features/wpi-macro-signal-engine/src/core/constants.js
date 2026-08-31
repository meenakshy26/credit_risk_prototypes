export const ALL_COMMODITIES = '1000000000';
export const FUEL_AND_POWER = '1200000000';

export const ROLES = Object.freeze(['BUY', 'SELL', 'STOCK', 'COST', 'WATCH']);

export const LEVEL = Object.freeze({
  ALL: 'ALL',
  MAJOR_GROUP: 'Major Group',
  GROUP: 'Group',
  SUB_GROUP: 'Sub Group',
  SS_GROUP: 'S_S_Group',
  ITEM: 'Item',
});

/**
 * PRD §6 and §8. These are heuristics until Phase 4 calibrates them against
 * actual borrower outcomes, so they live in one place and nowhere else.
 */
export const THRESHOLDS = Object.freeze({
  itemRed: 0.2,
  itemOrange: 0.1,
  marginSqueezeRed: -0.03,
  inventoryLoss: -0.1,
  inventoryGain: 0.1,
  driverGap: 0.05,
  fxWeaker: 0.05,
});

export const STATUS = Object.freeze({ GREEN: 'GREEN', AMBER: 'AMBER', RED: 'RED' });

export const SEVERITY_RANK = Object.freeze({ GREEN: 0, AMBER: 1, RED: 2 });

/** The 10-digit code is a fixed-width hierarchy, so a parent is a prefix cut. */
export const CODE_LEVEL_WIDTH = Object.freeze({
  [LEVEL.MAJOR_GROUP]: 2,
  [LEVEL.GROUP]: 4,
  [LEVEL.SUB_GROUP]: 6,
  [LEVEL.SS_GROUP]: 8,
  [LEVEL.ITEM]: 10,
});
