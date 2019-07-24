import { CocoonNode } from '@cocoon/types';
import castFunction from '@cocoon/util/castFunction';
import resolveFilePath from '@cocoon/util/resolveFilePath';
import spawnChildProcess from '@cocoon/util/spawnChildProcess';
import fs from 'fs';
import got from 'got';
import _ from 'lodash';
import path from 'path';
import stream from 'stream';
import { promisify } from 'util';

const pipeline = promisify(stream.pipeline);

interface Source {
  name?: string;
  url: string;
}

type MapFunction = (item: object) => Source | Source[];

export interface Ports {
  attribute: string;
  batchSize: number;
  clean: boolean;
  data: object[];
  each?: string;
  map?: string | MapFunction;
  options?: got.GotOptions<any>;
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
    clean: {
      description: `Remove files in target folder that weren't scheduled for download.`,
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
    },
    options: {
      description: `Options for "got" (https://github.com/sindresorhus/got#options).`,
      hide: true,
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
    paths: {},
  },

  async *process(context) {
    const ports = context.ports.read();
    const {
      attribute,
      batchSize,
      clean,
      data,
      map,
      postprocess,
      skip,
      target,
    } = ports;
    const getImageData = map ? castFunction<MapFunction>(map) : _.identity;
    const targetRoot = resolveFilePath(target);

    // Make sure the target directory exists
    yield [`Creating target directory`, 0];
    await fs.promises.mkdir(targetRoot, { recursive: true });

    // Collect sources for each data item
    const sourcesForItem = data
      .map(item => ({
        item,
        source: getImageData(item),
      }))
      .filter(x => Boolean(x.source));

    // Get flattened list of valid sources
    yield [`Preparing sources`, 0];
    const sources = sourcesForItem.flatMap(x =>
      _.castArray(x.source)
        .map(y => (_.isString(y) ? { url: y } : y))
        .filter(y => Boolean(y.url))
        .map(y => {
          const fileName = y.name || y.url.slice(y.url.lastIndexOf('/') + 1);
          const extension = path.extname(y.url);
          return {
            ...y,
            extension,
            fileName,
            filePath: path.join(targetRoot, fileName),
            item: x.item,
          };
        })
    );

    // Decide if we need to store multiple results per item
    const multipleImagesPerItem = sourcesForItem.some(x => _.isArray(x.source));

    // Download files in batches
    let numDownloaded = 0;
    let numSkipped = 0;
    for (let i = 0; i < sources.length; i += batchSize) {
      const downloads = sources
        .slice(i, i + batchSize)
        .map(async ({ filePath, item, url }) => {
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
          } else {
            numSkipped += 1;
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
        });
      yield [
        `${downloads.length} active downloads, ${numDownloaded} completed`,
        numDownloaded / sources.length,
      ];
      await Promise.all(downloads);
    }

    // Clean surplus files
    let numRemoved = 0;
    if (clean) {
      yield [`Cleaning target directory`, 99];
      const fileNames = new Set(sources.map(x => x.fileName));
      const filesToRemove = (await fs.promises.readdir(targetRoot)).filter(
        file => !fileNames.has(file)
      );
      if (filesToRemove.length > 0) {
        context.debug(`Removing files that were not scheduled`, filesToRemove);
        await Promise.all(
          filesToRemove.map(file =>
            fs.promises.unlink(path.join(targetRoot, file))
          )
        );
        numRemoved = filesToRemove.length;
      }
    }

    context.ports.write({
      data,
      paths: sources.map(x => x.filePath),
    });
    return `Downloaded ${numDownloaded}, removed ${numRemoved} and skipped ${numSkipped} files`;
  },
};

async function download(source: string, target: string) {
  await pipeline(got.stream(source), fs.createWriteStream(target));
}
