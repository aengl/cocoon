import got from 'got';
import { NodeObject } from '../../../common/node';

export interface Ports {
  attributes: string[];
  data: object[];
}

/**
 * Resolves the target URL of a shortened URL.
 */
export const UnshortenURLs: NodeObject<Ports> = {
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
    const ports = context.ports.read();
    const data = context.ports.copy(ports.data);
    let numResolved = 0;
    for (const item of data) {
      await Promise.all(
        ports.attributes.map(async attr => {
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
    context.ports.write({ data });
    return `Resolved ${numResolved} URLs`;
  },
};
