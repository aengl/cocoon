import fs from 'fs';
import got from 'got';
import _ from 'lodash';
import path from 'path';
import { castFunction } from '../../../common/cast';
import { NodeObject } from '../../../common/node';
import { resolvePath } from '../../fs';
import { runProcess } from '../../process';

type NameResolver = (item: object) => string;
type UrlResolver = (imageUrl: string) => string;

interface Image {
  dataItem: any;
  videoItem: object;
  source: string;
}

export interface Ports {
  batchSize: number;
  data: any;
  each: string;
  pause: number;
  postprocess: string;
  resolveName: string;
  resolveUrl: string;
  sourceAttribute: string;
  targetAttribute: string;
  target: string;
}

export const ImageDownloader: NodeObject<Ports> = {
  category: 'I/O',
  description: `Downloads images from URLs`,

  in: {
    batchSize: {
      defaultValue: 5,
      hide: true,
    },
    data: {
      clone: true,
      required: true,
    },
    each: {
      hide: true,
    },
    pause: {
      hide: true,
    },
    postprocess: {
      hide: true,
    },
    resolveName: {
      hide: true,
    },
    resolveUrl: {
      hide: true,
    },
    sourceAttribute: {
      hide: true,
      required: true,
    },
    target: {
      defaultValue: '.',
      hide: true,
    },
    targetAttribute: {
      defaultValue: 'image_source',
      hide: true,
    },
  },

  out: {
    data: {},
  },

  async process(context) {
    const ports = context.ports.read();
    const { data } = ports;
    const resolveNameFn = castFunction<NameResolver>(ports.resolveName);
    const resolveUrlFn = castFunction<UrlResolver>(ports.resolveUrl);
    const targetRoot = resolvePath(ports.target, {
      root: context.definitions.root,
    });

    // Make sure the target directory exists
    await context.fs.createPath(targetRoot);

    // Collect all image sources
    let images: Image[] = ports.each
      ? // An item can contain multiple image sources -- if `each` is defined we
        // need to iterate the `each`-key and return all sources
        data.flatMap(item =>
          _.get(item, ports.each, []).map(x => ({
            dataItem: item,
            source: _.get(x, ports.sourceAttribute),
            videoItem: x,
          }))
        )
      : data.map(item => ({
          dataItem: item,
          source: _.get(item, ports.sourceAttribute),
          videoItem: item,
        }));

    // Filter images without a valid source
    images = images.filter(({ source }) => !_.isNil(source));

    // Download images in batches
    let downloadCount = 0;
    for (let i = 0; i < images.length; i += ports.batchSize) {
      const sources = images.slice(i, i + ports.batchSize);

      await Promise.all(
        sources.map(async ({ dataItem, source, videoItem }) => {
          const resolvedSource = resolveUrlFn ? resolveUrlFn(source) : source;
          const extension = path.extname(resolvedSource);
          const fileName = resolveNameFn
            ? resolveNameFn(videoItem)
            : path.basename(resolvedSource);
          const resolvedTarget = path.join(
            targetRoot,
            `${fileName}${extension}`
          );
          context.debug(
            `downloading "${resolvedSource}" to "${resolvedTarget}"`
          );

          // Download the image
          await download(resolvedSource, resolvedTarget);

          // Write download path to data item -- if we have multiple videos per
          // item, concatenate the path to already existing ones
          if (ports.each) {
            _.set(
              dataItem,
              ports.targetAttribute,
              _.concat(
                _.get(dataItem, ports.targetAttribute, []),
                resolvedTarget
              )
            );
          } else {
            _.set(dataItem, ports.targetAttribute, resolvedTarget);
          }

          // Run post-processing on the downloaded image
          if (ports.postprocess) {
            await runProcess(ports.postprocess, {
              args: [resolvedTarget],
              cwd: context.definitions.root,
            });
          }

          // Report progress
          context.progress(
            `Downloaded ${downloadCount} images`,
            i / data.length
          );
        })
      );
      downloadCount += sources.length;

      if (ports.pause) {
        const randomisedPause = _.random(ports.pause * 0.8, ports.pause * 1.2);
        context.debug(`waiting for ${randomisedPause}ms`);
        await new Promise(resolve => setTimeout(resolve, randomisedPause));
      }
    }

    context.ports.write({ data });
    return `Downloaded ${downloadCount} images`;
  },
};

async function download(source: string, target: string) {
  const response = await got(source, {
    encoding: null,
    timeout: 30000,
  });
  fs.writeFileSync(target, response.body);
}
