import Qty from 'js-quantities';
import _ from 'lodash';
import { isMetaKey, listDimensions } from '../../../common/data';
import { createTokenRegex } from '../../../common/nlp';
import { CocoonNodeContext, CocoonNode } from '../../../common/node';

export interface Ports {
  data: object[];
  domain: string | Array<string | DomainDefinition>;
  keys: string | string[];
  prune: boolean;
}

export const Domain: CocoonNode<Ports> = {
  category: 'Data',
  description: `Transforms items in a collection to conform to a domain.`,

  in: {
    data: {
      required: true,
    },
    domain: {
      hide: true,
      required: true,
    },
    keys: {
      hide: true,
    },
    prune: {
      defaultValue: false,
      hide: true,
    },
  },

  out: {
    data: {},
  },

  async process(context) {
    const { debug } = context;
    const ports = context.ports.read();
    const data = context.ports.copy(ports.data);

    // Parse domain
    let domain: DomainDefinition;
    if (_.isArray(ports.domain)) {
      // If there are multiple domain files, merge them into a single domain
      const contents = await Promise.all(
        ports.domain.map(uriOrDomain =>
          context.uri.resolveYaml<DomainDefinition>(uriOrDomain, {
            root: context.definitions.root,
          })
        )
      );
      domain = contents.reduce((all, d) => _.merge(all, d), {});
    } else {
      domain = await context.uri.resolveYaml<DomainDefinition>(ports.domain, {
        root: context.definitions.root,
      });
    }

    // Apply domains
    const dataDimensions = listDimensions(data);
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
    context.ports.write({ data });
    return `Matched ${matchedDimensions.size} dimensions`;
  },
};

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

interface DomainDefinition {
  [domainId: string]: Domain;
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
