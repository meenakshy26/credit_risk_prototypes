import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { addMonths } from '../core/months.js';

/**
 * PRD §4: "New xlsx ~14th monthly" from eaindustry.nic.in/download_data_2223.asp.
 * The published filename encodes the *publication* month (e.g. a file uploaded
 * in August is wpi_monthly_index_202608.xlsx, carrying data through June/July),
 * not the data month — so there is no way to compute the exact current filename
 * from the WPI data alone. We try the current calendar month first and step
 * backward, since a new month's file usually is not live yet in the first two
 * weeks while last month's is still the most recent one published.
 */
export const WPI_PAGE_URL = 'https://eaindustry.nic.in/download_data_2223.asp';
export const WPI_BASE_URL = 'https://eaindustry.nic.in/indx_download_2223/';
const USER_AGENT = 'Mozilla/5.0 (compatible; wpi-macro-signal-engine/1.0)';

export function wpiFileName(month) {
  return `wpi_monthly_index_${month.replace('-', '')}.xlsx`;
}

function candidateMonths(referenceMonth, lookback) {
  const months = [];
  for (let i = 0; i < lookback; i += 1) months.push(addMonths(referenceMonth, -i));
  return months;
}

function currentMonth(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Downloads the most recently published WPI item-wise monthly file and saves
 * it under `destDir`. Tries the current publication month first, then walks
 * backward up to `lookback` months. Throws if none of them resolve — the
 * caller (CLI / scheduled job) is expected to alert and retry the next day,
 * per §4 rule 1.
 */
export async function downloadLatestFile({ destDir = 'data/raw', lookback = 3, referenceDate = new Date(), fetchImpl = fetch } = {}) {
  mkdirSync(destDir, { recursive: true });
  const tried = [];

  for (const month of candidateMonths(currentMonth(referenceDate), lookback)) {
    const fileName = wpiFileName(month);
    const url = `${WPI_BASE_URL}${fileName}`;
    let res;
    try {
      res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT } });
    } catch (err) {
      tried.push(`${url} (${err.message})`);
      continue;
    }
    if (!res.ok) {
      tried.push(`${url} (HTTP ${res.status})`);
      continue;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const destPath = join(destDir, fileName);
    writeFileSync(destPath, buffer);
    return { path: destPath, url, publicationMonth: month, bytes: buffer.length };
  }

  throw new Error(
    `Could not find a live WPI file for the last ${lookback} publication month(s) at ${WPI_BASE_URL} ` +
      `(tried: ${tried.join(', ')}). Check ${WPI_PAGE_URL} manually — the publisher may not have released this month's file yet.`,
  );
}
