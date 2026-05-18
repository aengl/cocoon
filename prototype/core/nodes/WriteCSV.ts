import { promises as fs } from 'node:fs';
import { pick } from '../lodash-lite.ts';
import type { CocoonProcessNode } from '../contract.ts';

/**
 * Port of legacy `@cocoon/cocoon` io/WriteCSV. The self-contained
 * `arrayToCSV` is kept verbatim (legacy quoting: only string cells are
 * `"`-wrapped, no escaping — bug-for-bug faithful); lodash `_.pick` shed to
 * `../lodash-lite.ts`. Path resolved against the cocoon dir like `WriteJSON`.
 */
export const WriteCSV: CocoonProcessNode = {
  category: 'I/O',
  description: `Writes a collection to a CSV file.`,

  async *process(context) {
    const {
      attributes,
      data,
      path: filePath,
    } = context.ports.read() as {
      attributes?: string[];
      data: Record<string, unknown>[];
      path: string;
    };
    const cleanedData = attributes
      ? data.map(x => pick(x, attributes))
      : data;

    const csvString = arrayToCSV(cleanedData);

    const abs = context.resolvePath(filePath);
    await fs.writeFile(abs, csvString);
    return data.length
      ? `Exported ${data.length} items`
      : `Exported "${filePath}"`;
  },
};

function arrayToCSV(dataArray: Record<string, unknown>[]) {
  if (!Array.isArray(dataArray) || dataArray.length === 0) {
    throw new Error('Input must be a non-empty array.');
  }

  const headers = Object.keys(dataArray[0]);
  const rows = dataArray.map(obj => {
    return headers.map(header => {
      const value = obj[header];
      // return value;
      return typeof value === 'string' ? `"${value}"` : value;
    });
  });

  const csvRows = [headers.join(',')];
  for (const row of rows) {
    csvRows.push(row.join(','));
  }

  return csvRows.join('\n');
}
