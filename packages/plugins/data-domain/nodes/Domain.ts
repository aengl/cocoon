import { CocoonNode, CocoonNodeContext } from '@cocoon/types';
import castRegularExpression from '@cocoon/util/castRegularExpression';
import listDataAttributes from '@cocoon/util/listDataAttributes';
import requestUri from '@cocoon/util/requestUri';
import got from 'got';
import Qty from 'js-quantities';
import yaml from 'js-yaml';
import _ from 'lodash';

const isMetaKey = (key: string) => key.startsWith('$') || key.startsWith('_');

export interface Ports {
  data: object[];
  domain: string | DomainDefinition | Array<string | DomainDefinition>;
  keys: string | string[];
  prune: boolean;
}

export type DimensionType =
  | 'string'
  | 'number'
  | 'quantity'
  | 'discreet'
  | 'boolean';

export interface DomainDimension {
  name: string;
  type?: DimensionType;
  match?: string[];
  replace?: Array<[string, string]>;

  // quantity
  unit?: string;

  // discreet
  values?: { [value: string]: string[] };
  valuesRegex?: { [value: string]: RegExp[] };
}

export type Domain = DomainDimension[];

export interface DomainDefinition {
  [domainId: string]: Domain;
}

export const Domain: CocoonNode<Ports> = {
  category: 'Data',
  description: `Transforms items in a collection to conform to a domain.`,

  in: {
    data: {
      clone: true,
      required: true,
    },
    domain: {
      required: true,
      visible: false,
    },
    keys: {
      visible: false,
    },
    prune: {
      defaultValue: false,
      visible: false,
    },
  },

  out: {
    data: {},
  },

  async *process(context) {
    const { debug } = context;
    const ports = context.ports.read();
    const { data } = ports;

    // Parse domain
    const domain = _.isArray(ports.domain)
      ? // If there are multiple domain files, merge them into a single domain
        (await Promise.all(ports.domain.map(requestDomain))).reduce(
          (acc, d) => _.merge(acc, d),
          {}
        )
      : await requestDomain(ports.domain);

    // Apply domains
    const dataDimensions = listDataAttributes(data);
    const matchedDimensions = new Set(
      _.castArray(ports.keys || Object.keys(domain))
        .flatMap(key => {
          debug(`applying domain "${key}"`);
          if (domain[key] === undefined) {
            throw new Error(`domain key not found: "${key}"`);
          }
          return domain[key].map(dimension =>
            processDimension(data, dimension, dataDimensions, debug)
          );
        })
        .filter(x => Boolean(x))
    );

    // Prune data
    if (ports.prune) {
      const pruned = dataDimensions.filter(
        key => !matchedDimensions.has(key) && !isMetaKey(key)
      );
      data.forEach(item => {
        pruned.forEach(key => {
          delete item[key];
        });
      });
      debug(`removed ${pruned.length} dimensions`, pruned);
    }

    // Write result
    context.ports.write({ data });
    return `Matched ${matchedDimensions.size} dimensions`;
  },
};

function requestDomain(uriOrDomain: string | DomainDefinition) {
  return _.isString(uriOrDomain)
    ? requestUri<DomainDefinition>(
        uriOrDomain,
        async x => (await got(x)).body,
        x => yaml.safeLoad(x)
      )
    : uriOrDomain;
}

/**
 * Creates a regular expression for matching a word as a token (i.e. in a
 * sentence, taking word boundaries into consideration).
 * @param pattern A word or pattern.
 * @param flags Additional flags for the regular expression.
 */
function createTokenRegex(pattern: string, flags = '') {
  const regex = castRegularExpression(pattern);
  return new RegExp(
    `(^| )(${regex.source})($| )`,
    _.uniq((flags + regex.flags).split('')).join('')
  );
}

function processDimension(
  data: object[],
  dimension: DomainDimension,
  dataDimensions: string[],
  debug: CocoonNodeContext['debug']
) {
  // Find matching data dimension
  const regularExpressions = (dimension.match || [dimension.name]).map(s =>
    createTokenRegex(s, 'i')
  );
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
        if (!isMetaKey(matchingDimensionName)) {
          // Always preserve meta dimensions, they will be duplicated instead
          delete item[matchingDimensionName];
        }
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
  debug: CocoonNodeContext['debug']
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
