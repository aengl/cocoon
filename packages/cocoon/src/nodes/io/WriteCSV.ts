import { CocoonNode } from '@cocoon/types';
import fs from 'fs';
import _ from 'lodash';

export interface Ports {
  attributes?: string[];
  data: object[];
  path: string;
}

export const WriteCSV: CocoonNode<Ports> = {
  category: 'I/O',
  description: `Writes a collection to a CSV file.`,

  defaultActions: {
    'Open CSV file': 'open ${this.path}',
  },

  in: {
    attributes: {
      description: `Only serialise the listed attributes.`,
      visible: false,
    },
    data: {
      required: true,
    },
    path: {
      defaultValue: 'data.csv',
      visible: false,
    },
  },

  async *process(context) {
    const {
      attributes,
      data,
      path: filePath,
    } = context.ports.read();
    const cleanedData = attributes
      ? data.map(x => _.pick(x, attributes))
      : data;

    const csvString = arrayToCSV(cleanedData);

    await fs.promises.writeFile(filePath, csvString);
    return data.length
      ? `Exported ${data.length} items`
      : `Exported "${filePath}"`;
  },
};

function arrayToCSV(dataArray) {
  if (!Array.isArray(dataArray) || dataArray.length === 0) {
    throw new Error("Input must be a non-empty array.");
  }

  const headers = Object.keys(dataArray[0]);
  const rows = dataArray.map(obj => {
    return headers.map(header => {
      const value = obj[header];
      // return value;
      return typeof value === "string" ? `"${value}"` : value;
    });
  });

  const csvRows = [headers.join(",")];
  for (const row of rows) {
    csvRows.push(row.join(","));
  }

  return csvRows.join("\n");
}