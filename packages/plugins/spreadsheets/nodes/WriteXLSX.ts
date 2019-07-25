import { CocoonNode } from '@cocoon/types';
import XLSX from 'xlsx';
import _ from 'lodash';

export interface Ports {
  data: object[];
  join?: string;
  path: string;
}

export const WriteXLSX: CocoonNode<Ports> = {
  category: 'I/O',
  description: `Writes data into a spreadsheet file.`,

  in: {
    data: {
      required: true,
    },
    join: {
      visible: false,
    },
    path: {
      defaultValue: 'data.xlsx',
      visible: false,
    },
  },

  out: {
    path: {},
  },

  async *process(context) {
    const ports = context.ports.read();
    const { data, path: filePath } = ports;

    const workbook = {
      Props: {
        Author: 'Cocoon',
        Title: 'Data Export from Cocoon',
      },
      SheetNames: [],
      Sheets: {},
    };

    // Join array values
    const sheetData = ports.join
      ? data.map(item =>
          _.mapValues(item, (x: any) => (_.isArray(x) ? x.join(ports.join) : x))
        )
      : data;

    const sheet = XLSX.utils.json_to_sheet(sheetData);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Data');
    XLSX.writeFile(workbook, filePath);

    return data.length
      ? `Exported ${data.length} items`
      : `Exported "${filePath}"`;
  },
};
