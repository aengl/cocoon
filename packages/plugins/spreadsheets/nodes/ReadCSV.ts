import { CocoonNode } from '@cocoon/types';
import castFunction from '@cocoon/util/castFunction';
import streamUri from '@cocoon/util/streamUri';
import csv from 'csv-parser';
import got from 'got';
import _ from 'lodash';

type FilterFunction = (...args: any[]) => boolean;

export interface Ports {
  filter?: string | string[] | FilterFunction | FilterFunction[];
  options?: csv.Options;
  tabs?: boolean;
  uri: string;
}

export const ReadCSV: CocoonNode<Ports> = {
  category: 'I/O',
  description: `Imports data from a CSV file.`,

  in: {
    filter: {
      visible: false,
    },
    options: {
      visible: false,
    },
    tabs: {
      defaultValue: false,
      visible: false,
    },
    uri: {
      required: true,
      visible: false,
    },
  },

  out: {
    data: {},
  },

  async *process(context) {
    const { filter, options, tabs, uri } = context.ports.read();
    const useTabs =
      tabs === undefined ? (uri.endsWith('.tsv') ? true : false) : tabs;
    const filterList = _.castArray<any>(filter || []).map(x =>
      castFunction<FilterFunction>(x)
    );
    const stream = streamUri(uri, x => got.stream(x)).pipe(
      csv({ separator: useTabs ? '\t' : ',', ...(options || {}) })
    );
    const data: any[] = [];
    for await (const item of stream) {
      if (filterList.every(f => Boolean(f(item)))) {
        data.push(item);
      }
    }
    context.ports.write({ data });
    return data.length ? `Imported ${data.length} items` : `Imported "${uri}"`;
  },
};
