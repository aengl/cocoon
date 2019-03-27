import got from 'got';
import { NodeObject } from '../../../common/node';

/**
 * Resolves the target URL of a shortened URL.
 */
export const UnshortenURLs: NodeObject = {
  category: 'Services',

  in: {
    attributes: {
      hide: true,
      required: true,
    },
    data: {
      required: true,
    },
  },

  out: {
    data: {},
  },

  async process(context) {
    const data = context.ports.copy<object[]>('data');
    const attributes = context.ports.copy<string[]>('attributes');
    let numResolved = 0;
    for (const item of data) {
      await Promise.all(
        attributes.map(async attr => {
          const url = item[attr];
          if (url !== undefined) {
            const result = await got(url, {
              followRedirect: false,
            });
            const targetUrl = result.headers.location || result.url;
            context.debug(`resolved "${url}" to "${targetUrl}"`);
            item[attr] = targetUrl;
            numResolved += 1;
          }
        })
      );
    }
    context.ports.writeAll({ data });
    return `Resolved ${numResolved} URLs`;
  },
};
