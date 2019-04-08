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

/**
 * Downloads images from URLs.
 */
export const ImageDownloader: NodeObject = {
  category: 'I/O',

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
    const {
      batchSize,
      data,
      each,
      pause,
      postprocess,
      resolveName,
      resolveUrl,
      sourceAttribute,
      targetAttribute,
      target,
    } = context.ports.readAll();
    const resolveNameFn = castFunction<NameResolver>(resolveName);
    const resolveUrlFn = castFunction<UrlResolver>(resolveUrl);
    const targetRoot = resolvePath(target, {
      root: context.definitions.root,
    });

    // Make sure the target directory exists
    await context.fs.createPath(targetRoot);

    // Collect all image sources
    let images: Image[] = each
      ? // An item can contain multiple image sources -- if `each` is defined we
        // need to iterate the `each`-key and return all sources
        data.flatMap(item =>
          _.get(item, each, []).map(x => ({
            dataItem: item,
            source: _.get(x, sourceAttribute),
            videoItem: x,
          }))
        )
      : data.map(item => ({
          dataItem: item,
          source: _.get(item, sourceAttribute),
          videoItem: item,
        }));

    // Filter images without a valid source
    images = images.filter(({ source }) => !_.isNil(source));

    // Download images in batches
    let downloadCount = 0;
    for (let i = 0; i < images.length; i += batchSize) {
      const sources = images.slice(i, i + batchSize);

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
          if (each) {
            _.set(
              dataItem,
              targetAttribute,
              _.concat(_.get(dataItem, targetAttribute, []), resolvedTarget)
            );
          } else {
            _.set(dataItem, targetAttribute, resolvedTarget);
          }

          // Run post-processing on the downloaded image
          if (postprocess) {
            await runProcess(postprocess, {
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

      if (pause) {
        const randomisedPause = _.random(pause * 0.8, pause * 1.2);
        context.debug(`waiting for ${randomisedPause}ms`);
        await new Promise(resolve => setTimeout(resolve, randomisedPause));
      }
    }

    context.ports.writeAll({ data });
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
