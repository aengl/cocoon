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

/**
 * Downloads images from URLs.
 */
export const ImageDownloader: NodeObject = {
  category: 'I/O',

  in: {
    batchSize: {
      defaultValue: 5,
    },
    data: {
      clone: true,
      required: true,
    },
    pause: {},
    postprocess: {},
    resolveName: {},
    resolveUrl: {},
    sourceAttribute: {
      required: true,
    },
    target: {
      defaultValue: '.',
    },
    targetAttribute: {
      defaultValue: 'image_source',
    },
  },

  out: {
    data: {},
  },

  async process(context) {
    const {
      batchSize,
      data,
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

    let downloadCount = 0;
    for (let i = 0; i < data.length; i += batchSize) {
      const sources = data
        .slice(i, i + batchSize)
        .map(item => ({ item, source: _.get(item, sourceAttribute) }))
        .filter(({ source }) => !_.isNil(source));

      if (sources.length > 0) {
        await Promise.all(
          sources.map(async ({ item, source }) => {
            const resolvedSource = resolveUrlFn ? resolveUrlFn(source) : source;
            const extension = path.extname(resolvedSource);
            const fileName = resolveNameFn
              ? resolveNameFn(item)
              : path.basename(resolvedSource);
            const resolvedTarget = path.join(
              targetRoot,
              `${fileName}${extension}`
            );
            context.debug(
              `downloading "${resolvedSource}" to "${resolvedTarget}"`
            );
            await download(resolvedSource, resolvedTarget);
            _.set(item, targetAttribute, resolvedTarget);
            if (postprocess) {
              await runProcess(postprocess, {
                args: [resolvedTarget],
                cwd: context.definitions.root,
              });
            }
            context.progress(
              `Downloaded ${downloadCount} images`,
              i / data.length
            );
          })
        );
        downloadCount += sources.length;

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
