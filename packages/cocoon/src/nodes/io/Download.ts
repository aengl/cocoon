import { CocoonNode } from '@cocoon/types';
import castFunction from '@cocoon/util/castFunction';
import resolveFilePath from '@cocoon/util/resolveFilePath';
import spawnChildProcess from '@cocoon/util/spawnChildProcess';
import fs from 'fs';
import got from 'got';
import _ from 'lodash';
import path from 'path';

interface Source {
  name?: string;
  url: string;
}

type MapFunction = (item: object) => Source | Source[];

export interface Ports {
  attribute: string;
  batchSize: number;
  data: object[];
  each?: string;
  map: string | MapFunction;
  postprocess?: string;
  skip?: boolean;
  target: string;
}

export const Download: CocoonNode<Ports> = {
  category: 'I/O',
  description: `Downloads files.`,

  in: {
    attribute: {
      defaultValue: 'files',
      description: `Target attribute where the path to the downloaded files are written to. Will be an array if "map" creates an array.`,
      hide: true,
    },
    batchSize: {
      defaultValue: 5,
      description: `Number of files to download in parallel.`,
      hide: true,
    },
    data: {
      clone: true,
      description: `The source data that will be mapped.`,
      required: true,
    },
    map: {
      description: `A function that maps the data item to an object containing the "name" (optional, new filename for the downloaded file) and "url" (required, URL of the file to download). Can also map to an array, in which case multiple files are downloaded for each data item.`,
      hide: true,
      required: true,
    },
    postprocess: {
      description: `Run a process per download, with the file path as the first argument.`,
      hide: true,
    },
    skip: {
      description: `If true, skips downloading if the file already exists.`,
      hide: true,
    },
    target: {
      defaultValue: '.',
      description: `The target path to store the files at.`,
      hide: true,
    },
  },

  out: {
    data: {},
  },

  async *process(context) {
    const ports = context.ports.read();
    const {
      attribute,
      batchSize,
      data,
      map,
      postprocess,
      skip,
      target,
    } = ports;
    const getImageData = castFunction<MapFunction>(map);
    const targetRoot = resolveFilePath(target);

    // Make sure the target directory exists
    await fs.promises.mkdir(targetRoot, { recursive: true });

    // Collect sources for each data item
    const sourcesForItem = data
      .map(item => ({
        item,
        source: getImageData(item),
      }))
      .filter(x => Boolean(x.source));

    // Get flattened list of valid sources
    const sources = sourcesForItem
      .flatMap(x =>
        _.castArray(x.source).map(y => ({
          ...y,
          item: x.item,
        }))
      )
      .filter(x => Boolean(x.url));

    // Decide if we need to store multiple results per item
    const multipleImagesPerItem = sourcesForItem.some(x => _.isArray(x.source));

    // Download files in batches
    let numDownloaded = 0;
    for (let i = 0; i < sources.length; i += batchSize) {
      await Promise.all(
        sources.slice(i, i + batchSize).map(async ({ item, name, url }) => {
          const extension = path.extname(url);
          const fileName = name || path.basename(url);
          const filePath = path.join(targetRoot, `${fileName}${extension}`);

          // Download the file
          if (!skip || !fs.existsSync(filePath)) {
            context.debug(`downloading "${url}" to "${filePath}"`);
            await download(url, filePath);
            numDownloaded += 1;
            if (postprocess) {
              // Run post-processing on the downloaded file
              await spawnChildProcess(postprocess, {
                args: [filePath],
                cwd: context.cocoonFile.root,
                debug: context.debug,
              });
            }
          }

          // Write download path to data item -- if we have multiple videos
          // per item, concatenate the path to already existing ones
          if (multipleImagesPerItem) {
            _.set(
              item,
              attribute,
              _.concat(_.get(item, attribute, []), filePath)
            );
          } else {
            _.set(item, attribute, filePath);
          }
        })
      );
      yield [`Downloaded ${numDownloaded} files`, i / sources.length];
    }

    context.ports.write({ data });
    return `Downloaded ${numDownloaded} files`;
  },
};

async function download(source: string, target: string) {
  const response = await got(source, {
    encoding: null,
    timeout: 30000,
  });
  return fs.promises.writeFile(target, response.body);
}
