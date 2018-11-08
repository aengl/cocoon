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
    const data = context.readFromPort<object[]>('data');
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
  type?: 'string' | 'number' | 'number_with_unit';
  match: string[];
}

type Domain = DomainDimension[];

function processDimension(
  data: object[],
  dimension: DomainDimension,
  dataDimensions: string[],
  debug: NodeContext['debug']
) {
  // Find matching data dimension
  const regularExpressions = dimension.match.map(s => castRegularExpression(s));
  const matchingDimensionName = dataDimensions.find(dimensionName =>
    regularExpressions.some(re => dimensionName.match(re) !== null)
  );

  // Apply domain
  if (matchingDimensionName !== undefined) {
    debug(
      `Data dimension "${matchingDimensionName}" matches "${dimension.name}"`
    );

    // Normalise dimension name
    data.forEach(item => {
      if (item[matchingDimensionName] !== undefined) {
        item[dimension.name] = item[matchingDimensionName];
        delete item[matchingDimensionName];
      }
    });
  }
}
