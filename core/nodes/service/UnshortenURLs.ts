import got from 'got';
import { NodeObject } from '../../../common/node';

/**
 * Resolves the target URL of a shortened URL.
 */
export const UnshortenURLs: NodeObject = {
  in: {
    attributes: {
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
    const data = context.cloneFromPort<object[]>('data');
    const attributes = context.cloneFromPort<string[]>('attributes');
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
    context.writeToPort('data', data);
    return `resolved ${numResolved} URLs`;
  },
};
