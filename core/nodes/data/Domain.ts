import Qty from 'js-quantities';
import _ from 'lodash';
import { ICocoonNode, listDimensions, NodeContext } from '..';
import { parseYamlFile } from '../../fs';
import { castRegularExpression } from '../../regex';

export interface IDomainConfig {
  keys: string[];
}

const Domain: ICocoonNode<IDomainConfig> = {
  in: {
    data: {
      required: true,
    },
    domain: {
      required: true,
    },
  },

  out: {
    data: {},
  },

  process: async context => {
    const { debug } = context;
    const data = context.cloneFromPort<object[]>('data');
    let domainFile = context.readFromPort<string | object>('domain');
    if (_.isString(domainFile)) {
      domainFile = (await parseYamlFile(
        domainFile,
        context.definitionsPath
      )) as object;
    }
    const dataDimensions = listDimensions(data);
    context.config.keys.forEach(key => {
      debug(`applying domain "${key}"`);
      const domain = domainFile[key];
      domain.forEach(dimension => {
        processDimension(data, dimension, dataDimensions, debug);
      });
    });
    context.writeToPort<object[]>('data', data);
    return `converted ${data.length} item(s)`;
  },
};

export { Domain };

interface DomainDimension {
  name: string;
  type?: 'string' | 'number' | 'quantity';
  match: string[];
  replace?: Array<[string, string]>;

  // quantity
  unit?: string;

  // discreet
  values?: { [value: string]: string[] };
}

type Domain = DomainDimension[];

function processDimension(
  data: object[],
  dimension: DomainDimension,
  dataDimensions: string[],
  debug: NodeContext['debug']
) {
  // Find matching data dimension
  const regularExpressions = dimension.match.map(s =>
    castRegularExpression(s, 'i')
  );
  const matchingDimensionName = dataDimensions.find(dimensionName =>
    regularExpressions.some(re => dimensionName.match(re) !== null)
  );

  // Apply domain
  if (matchingDimensionName !== undefined) {
    debug(
      `Data dimension "${matchingDimensionName}" matches "${dimension.name}"`
    );

    // Normalise dimension name and values
    data.forEach(item => {
      if (item[matchingDimensionName] !== undefined) {
        const v = parseValue(item[matchingDimensionName], dimension, debug);
        delete item[matchingDimensionName];
        if (_.isNil(v)) {
          delete item[dimension.name];
        } else {
          item[dimension.name] = v;
        }
      }
    });
  }
}

function normaliseNumber(v: any) {
  if (_.isString(v)) {
    return v.replace(/([0-9]),([0-9])/g, '$1.$2');
  }
  return v;
}

function parseValue(
  v: any,
  dimension: DomainDimension,
  debug: NodeContext['debug']
) {
  if (dimension.replace !== undefined) {
    v = dimension.replace.reduce((x: string, y) => x.replace(y[0], y[1]), v);
  }
  switch (dimension.type) {
    case 'number': {
      const n = parseFloat(normaliseNumber(v));
      return _.isNaN(n) ? null : n;
    }
    case 'quantity': {
      try {
        return _.isNil(v)
          ? null
          : new Qty(normaliseNumber(v)).to(dimension.unit!).scalar;
      } catch (error) {
        debug(error.message, v);
        return null;
      }
    }
  }
  return v;
}
