import { CocoonNode } from '@cocoon/types';
import XLSX from 'xlsx';

export interface Ports {
  data: object[];
  path: string;
}

export const WriteXLSX: CocoonNode<Ports> = {
  category: 'I/O',
  description: `Writes data into a spreadsheet file.`,

  in: {
    data: {
      required: true,
    },
    path: {
      defaultValue: 'data.xlsx',
      hide: true,
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

    const sheet = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Data');
    XLSX.writeFile(workbook, filePath);

    return data.length
      ? `Exported ${data.length} items`
      : `Exported "${filePath}"`;
  },
};
