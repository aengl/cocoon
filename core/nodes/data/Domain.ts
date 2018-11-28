import Qty from 'js-quantities';
import _ from 'lodash';
import { listDimensions, NodeContext, NodeObject } from '..';
import { isMetaKey } from '../../../common/data';
import { parseYamlFile } from '../../fs';
import { createTokenRegex } from '../../nlp';

export interface DomainConfig {
  keys: string[];
  prune?: boolean;
}

const Domain: NodeObject = {
  in: {
    data: {
      required: true,
    },
    domain: {
      required: true,
    },
    keys: {
      required: true,
    },
    prune: {
      defaultValue: false,
    },
  },

  out: {
    data: {},
  },

  process: async context => {
    const { debug } = context;
    const data = context.cloneFromPort<object[]>('data');
    let domain = context.readFromPort<string | object>('domain');

    // Parse domain
    if (_.isString(domain)) {
      domain = (await parseYamlFile(domain, context.definitionsPath)) as object;
    } else if (_.isArray(domain)) {
      // If there are multiple domain files, merge them into a single domain
      const contents = await Promise.all(
        domain.map(file => parseYamlFile(file, context.definitionsPath))
      );
      domain = contents.reduce((all, d) => _.merge(all, d), {});
    }

    // Apply domains
    const keys = context.readFromPort<string[]>('keys');
    const dataDimensions = listDimensions(data);
    const matchedDimensions = new Set(
      _.flatten(
        keys.map(key => {
          debug(`applying domain "${key}"`);
          if (domain[key] === undefined) {
            throw new Error(`domain key not found: "${key}"`);
          }
          return domain[key].map(dimension =>
            processDimension(data, dimension, dataDimensions, debug)
          );
        })
      )
    );

    // Prune data
    if (context.readFromPort<boolean>('prune')) {
      dataDimensions.forEach(key => {
        if (!matchedDimensions.has(key) && !isMetaKey(key)) {
          debug(`removing dimension "${key}"`);
          data.forEach(item => {
            delete item[key];
          });
        }
      });
    }

    // Write result
    context.writeToPort<object[]>('data', data);
    return `Matched ${matchedDimensions.size} dimensions`;
  },
};

export { Domain };

interface DomainDimension {
  name: string;
  type?: 'string' | 'number' | 'quantity' | 'discreet' | 'boolean';
  match: string[];
  replace?: Array<[string, string]>;

  // quantity
  unit?: string;

  // discreet
  values?: { [value: string]: string[] };
  valuesRegex?: { [value: string]: RegExp[] };
}

type Domain = DomainDimension[];

function processDimension(
  data: object[],
  dimension: DomainDimension,
  dataDimensions: string[],
  debug: NodeContext['debug']
) {
  // Find matching data dimension
  const regularExpressions = dimension.match.map(s => createTokenRegex(s, 'i'));
  const matchingDimensionName = dataDimensions.find(dimensionName =>
    regularExpressions.some(re => dimensionName.match(re) !== null)
  );

  // Apply domain
  if (matchingDimensionName !== undefined) {
    debug(
      `Data dimension "${matchingDimensionName}" matches "${dimension.name}"`
    );

    // Prepare dimension for processing
    prepareDimension(dimension);

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

    return matchingDimensionName;
  }

  return;
}

function prepareDimension(dimension: DomainDimension) {
  // Prepare regular expression for discreet dimensions
  if (dimension.values !== undefined) {
    dimension.valuesRegex = Object.keys(dimension.values)
      .map(value => ({
        regex: [
          createTokenRegex(value, 'i'),
          ...dimension.values![value].map(v => createTokenRegex(v)),
        ],
        value,
      }))
      .reduce((all, item) => {
        all[item.value] = item.regex;
        return all;
      }, {});
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
    case 'discreet': {
      const matchedValue = Object.keys(dimension.valuesRegex!).find(value =>
        dimension.valuesRegex![value].some(
          regex => (v.toString() as string).match(regex) !== null
        )
      );
      if (matchedValue === undefined) {
        debug(`unknown value "${v}" for dimension "${dimension.name}"`);
      }
      return matchedValue;
    }
    case 'boolean': {
      return Boolean(v) === true || v === 'true';
    }
  }
  return v;
}
